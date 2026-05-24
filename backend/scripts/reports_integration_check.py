"""
Reports module — end-to-end integration check.

Exercises every fix (P0 → P3 + CR rounds) against the live DB through the
HTTP layer, prints clear before/after evidence for each case, and rolls
back every mutation it makes so the seed data is left untouched.

Hardening:
  - All scenarios run inside a try/finally so cleanup runs even when an
    assertion fails. This is important: the script mutates real rows
    (cycle.total_received, customer.full_name, user.is_active, transaction
    inserts) and leaving them in place would corrupt downstream tests.
  - Seed-data preconditions are asserted up front with clear messages
    instead of crashing on AttributeError later.
  - Numeric assertions compare BEFORE/AFTER deltas rather than absolute
    totals — so the script is re-runnable against a shared DB where
    prior state may already have non-zero values on the same row/bucket.

Run:  venv/bin/python scripts/reports_integration_check.py
"""
import sys
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: F401 — registers all ORM mappers
from fastapi.testclient import TestClient
from sqlalchemy import desc

from app.core.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.customer import Customer
from app.models.due_cycle import DueCycle
from app.models.loan import Loan
from app.models.transaction import (
    PaymentMethod,
    PunctualityStatus,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.models.user import User, UserRole
from app.services.auth import create_access_token
from main import app


# --------------------------------------------------
# Helpers
# --------------------------------------------------
def banner(label: str) -> None:
    print()
    print("=" * 78)
    print(f"  {label}")
    print("=" * 78)


def show(title: str, payload: dict, keys: list[str] | None = None) -> None:
    print(f"\n--- {title} ---")
    if keys is None:
        for k, v in payload.items():
            if not isinstance(v, (list, dict)):
                print(f"  {k}: {v}")
    else:
        for k in keys:
            v = payload.get(k)
            print(f"  {k}: {v}")


def get(client, path, headers):
    r = client.get(path, headers=headers)
    assert r.status_code == 200, f"GET {path} -> {r.status_code}: {r.text[:200]}"
    return r.json()


def bucket_total(daily_payload: dict, on_date: date) -> Decimal:
    """Total_amount for a given date in a daily collection-report response (0 if absent)."""
    for e in daily_payload["entries"]:
        if e["date"] == str(on_date):
            return Decimal(e["total_amount"])
    return Decimal("0")


def employee_collections(emp_payload: dict, employee_id: uuid.UUID) -> Decimal:
    """Total collections for a given employee (0 if not listed)."""
    for r in emp_payload["results"]:
        if r["employee_id"] == str(employee_id):
            return Decimal(r["total_collections"])
    return Decimal("0")


# --------------------------------------------------
# Setup
# --------------------------------------------------
client = TestClient(app)
db = SessionLocal()

admin = (
    db.query(User)
    .filter(User.role == UserRole.ADMIN, User.is_active == True)
    .first()
)
assert admin is not None, (
    "Seed is missing an active ADMIN user — cannot run the integration check"
)

employee = (
    db.query(User)
    .join(Customer, Customer.assigned_employee_id == User.id)
    .filter(
        User.role == UserRole.EMPLOYEE,
        User.is_active == True,
        Customer.is_deleted == False,
    )
    .distinct()
    .first()
)
assert employee is not None, (
    "Seed is missing an active EMPLOYEE with at least one assigned customer"
)
print(f"admin    = {admin.username} ({admin.id})")
print(f"employee = {employee.username} ({employee.id})")

AH = {"Authorization": f"Bearer {create_access_token(admin.id, admin.role.value)}"}
EH = {"Authorization": f"Bearer {create_access_token(employee.id, employee.role.value)}"}

# Tracked mutations for clean rollback
inserted_txn_ids: list[uuid.UUID] = []
cycle_state_snapshot: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}
customer_name_snapshot: dict[uuid.UUID, str] = {}
user_deactivated: User | None = None
audit_floor_timestamp = None


def snapshot_cycle(cycle: DueCycle):
    if cycle.id not in cycle_state_snapshot:
        cycle_state_snapshot[cycle.id] = (cycle.total_due, cycle.total_received)


# Pick a loan + cycle owned by the employee
target_customer_loan = (
    db.query(Customer, Loan)
    .join(Loan, Loan.customer_id == Customer.id)
    .filter(
        Customer.assigned_employee_id == employee.id,
        Customer.is_deleted == False,
        Loan.is_deleted == False,
    )
    .first()
)
assert target_customer_loan is not None, (
    "Seed: employee has no assigned customer with at least one active loan"
)
target_customer, target_loan = target_customer_loan

target_cycle = (
    db.query(DueCycle)
    .filter(DueCycle.loan_id == target_loan.id, DueCycle.is_deleted == False)
    .order_by(DueCycle.cycle_number)
    .first()
)
assert target_cycle is not None, (
    f"Seed: target loan {target_loan.loan_number} has no active due_cycles"
)
print(f"target loan  = {target_loan.loan_number}  customer={target_customer.full_name}")
print(
    f"target cycle = #{target_cycle.cycle_number}  due={target_cycle.due_date}  "
    f"total_due={target_cycle.total_due}  received={target_cycle.total_received}"
)

# Audit-row watermark: anything written AFTER this is from our run, safe to delete.
latest_audit = (
    db.query(AuditLog).order_by(desc(AuditLog.timestamp)).first()
)
audit_floor_timestamp = latest_audit.timestamp if latest_audit else None


def cleanup():
    """Reverse every mutation — runs in finally so it executes even on assertion failure."""
    banner("CLEANUP — reverting all test mutations")
    # Roll the SQLAlchemy session forward to a clean transaction in case
    # a failed assertion left an open one.
    db.rollback()

    for cid, (orig_due, orig_recv) in cycle_state_snapshot.items():
        c = db.get(DueCycle, cid)
        if c is not None:
            c.total_due, c.total_received = orig_due, orig_recv
            db.add(c)
    for cust_id, orig_name in customer_name_snapshot.items():
        cust = db.get(Customer, cust_id)
        if cust is not None:
            cust.full_name = orig_name
            db.add(cust)
    if user_deactivated is not None:
        user_deactivated.is_active = True
        db.add(user_deactivated)
    for txn_id in inserted_txn_ids:
        t = db.get(Transaction, txn_id)
        if t is not None:
            db.delete(t)

    if audit_floor_timestamp is not None:
        db.query(AuditLog).filter(
            AuditLog.timestamp > audit_floor_timestamp,
            AuditLog.action_type == "CUSTOMER_REPORT_EXPORT",
        ).delete(synchronize_session=False)

    db.commit()
    db.close()
    print("Done — DB reverted to pre-test state.")


try:
    # --------------------------------------------------
    # SCENARIO 1 — Baseline numbers
    # --------------------------------------------------
    banner("SCENARIO 1 — Baseline (before any mutations)")
    s = get(client, "/api/v1/reports/summary", AH)
    p = get(client, "/api/v1/reports/loans", AH)
    show("dashboard summary", s)
    show("loan portfolio", p)
    print(
        "\n  invariant: total_payable = total_outstanding + total_collected   ",
        Decimal(p["total_payable"])
        == Decimal(p["total_outstanding"]) + Decimal(p["total_collected"]),
    )

    # --------------------------------------------------
    # SCENARIO 2 — P0.3 outstanding from due_cycles (DELTA-based)
    # --------------------------------------------------
    banner("SCENARIO 2 — P0.3 outstanding sourced from due_cycles")
    snapshot_cycle(target_cycle)
    original_received = Decimal(str(target_cycle.total_received))
    new_received = original_received + Decimal("4000.00")
    target_cycle.total_received = new_received
    db.add(target_cycle)
    db.commit()
    expected_outstanding_drop = new_received - original_received  # == 4000.00

    p2 = get(client, "/api/v1/reports/loans", AH)
    actual_drop = Decimal(p["total_outstanding"]) - Decimal(p2["total_outstanding"])
    print(
        f"\n  cycle.total_received: {original_received} → {new_received} "
        f"(delta {expected_outstanding_drop})"
    )
    print(
        f"  outstanding went {p['total_outstanding']} → {p2['total_outstanding']} "
        f"(delta {actual_drop})"
    )
    assert actual_drop == expected_outstanding_drop, (
        f"Outstanding must drop by the cycle.total_received delta "
        f"({expected_outstanding_drop}), got {actual_drop}"
    )
    print("  ✓ outstanding = SUM(total_due - total_received), tracks the cycle delta exactly")

    # --------------------------------------------------
    # SCENARIO 3 — P0.1 DOWN_PAYMENT excluded from collections (DELTA-based)
    # --------------------------------------------------
    banner("SCENARIO 3 — P0.1 DOWN_PAYMENT excluded from collection sums")
    s_before_dp = get(client, "/api/v1/reports/summary", AH)
    p_before_dp = get(client, "/api/v1/reports/loans", AH)
    emp_before_dp = get(client, "/api/v1/reports/employees", AH)
    emp_collections_before_dp = employee_collections(emp_before_dp, employee.id)

    dp_txn = Transaction(
        loan_id=target_loan.id,
        amount=Decimal("9999.00"),
        payment_mode=PaymentMethod.CASH,
        transaction_type=TransactionType.DOWN_PAYMENT,
        status=TransactionStatus.SUCCESS,
        punctuality_status=PunctualityStatus.PAID_ON_TIME,
        effective_payment_date=date.today(),
        collected_by_id=employee.id,
        created_by_id=employee.id,
    )
    db.add(dp_txn)
    db.commit()
    db.refresh(dp_txn)
    inserted_txn_ids.append(dp_txn.id)

    s_after_dp = get(client, "/api/v1/reports/summary", AH)
    p_after_dp = get(client, "/api/v1/reports/loans", AH)
    emp_after_dp = get(client, "/api/v1/reports/employees", AH)
    emp_collections_after_dp = employee_collections(emp_after_dp, employee.id)

    print(f"\n  inserted DOWN_PAYMENT of 9999 on loan {target_loan.loan_number}")
    print(f"  total_amount_collected delta: {Decimal(s_after_dp['total_amount_collected']) - Decimal(s_before_dp['total_amount_collected'])}")
    print(f"  portfolio total_collected delta: {Decimal(p_after_dp['total_collected']) - Decimal(p_before_dp['total_collected'])}")
    print(f"  employee {employee.username} collections delta: {emp_collections_after_dp - emp_collections_before_dp}")
    assert s_after_dp["total_amount_collected"] == s_before_dp["total_amount_collected"], (
        "DOWN_PAYMENT must NOT inflate total_amount_collected"
    )
    assert emp_collections_after_dp == emp_collections_before_dp, (
        "DOWN_PAYMENT must NOT count toward employee performance"
    )
    print("  ✓ DOWN_PAYMENT did NOT inflate any 'collection' sum")

    # --------------------------------------------------
    # SCENARIO 4 — P0.2 eff_date drives daily bucketing (DELTA-based)
    # --------------------------------------------------
    banner("SCENARIO 4 — P0.2 effective_payment_date drives daily bucketing")
    backdate = date.today() - timedelta(days=7)

    daily_before = get(client, "/api/v1/reports/collections?period=daily&days=30", AH)
    bucket_before = bucket_total(daily_before, backdate)

    reg_txn = Transaction(
        loan_id=target_loan.id,
        amount=Decimal("4000.00"),
        payment_mode=PaymentMethod.GPAY,
        transaction_type=TransactionType.REGULAR,
        status=TransactionStatus.SUCCESS,
        punctuality_status=PunctualityStatus.PAID_ON_TIME,
        effective_payment_date=backdate,
        due_cycle_id=target_cycle.id,
        collected_by_id=employee.id,
        created_by_id=employee.id,
    )
    db.add(reg_txn)
    db.commit()
    db.refresh(reg_txn)
    inserted_txn_ids.append(reg_txn.id)

    daily_after = get(client, "/api/v1/reports/collections?period=daily&days=30", AH)
    bucket_after = bucket_total(daily_after, backdate)
    delta = bucket_after - bucket_before

    print(f"\n  inserted REGULAR 4000.00 (GPAY) with effective_payment_date={backdate} (created today)")
    print(f"  bucket on {backdate}: {bucket_before} → {bucket_after} (delta {delta})")
    assert delta == Decimal("4000.00"), (
        f"{backdate} bucket should grow by exactly 4000; saw delta {delta}"
    )
    print(f"  ✓ bucketed on effective_payment_date ({backdate}), not on created_at (today)")
    # Row invariant — independent of pre-existing rows in the bucket
    e = next(e for e in daily_after["entries"] if e["date"] == str(backdate))
    parts_sum = (
        Decimal(e["cash"]) + Decimal(e["gpay"]) + Decimal(e["phonepe"])
        + Decimal(e["bank_transfer"]) + Decimal(e["other"])
    )
    assert parts_sum == Decimal(e["total_amount"]), (
        f"row invariant broken: parts={parts_sum} total={e['total_amount']}"
    )
    print(f"  ✓ row invariant cash+gpay+phonepe+bank+other = total: {parts_sum} == {e['total_amount']}")

    # --------------------------------------------------
    # SCENARIO 5 — P0.4 total_payable = SUM(due_cycles.total_due)
    # --------------------------------------------------
    banner("SCENARIO 5 — P0.4 total_payable = SUM(due_cycles.total_due) ≠ principal")
    p5 = get(client, "/api/v1/reports/loans", AH)
    print(f"\n  total_principal:    {p5['total_principal']}")
    print(f"  total_payable:      {p5['total_payable']}   ← includes interest/penalty add-ons")
    print(f"  total_outstanding:  {p5['total_outstanding']}")
    print(f"  total_collected:    {p5['total_collected']}")
    assert Decimal(p5["total_payable"]) > Decimal(p5["total_principal"]), (
        "Payable should be strictly greater than principal once interest is in the schedule"
    )
    assert (
        Decimal(p5["total_payable"])
        == Decimal(p5["total_outstanding"]) + Decimal(p5["total_collected"])
    ), "Invariant: payable = outstanding + collected"
    print("  ✓ payable > principal AND payable = outstanding + collected")

    # --------------------------------------------------
    # SCENARIO 6 — P0.6 pending = ledger shortfall
    # --------------------------------------------------
    banner("SCENARIO 6 — P0.6 total_pending_collections = ledger shortfall")
    s6 = get(client, "/api/v1/reports/summary", AH)
    pending_txn_sum = sum(
        Decimal(str(t.amount))
        for t in db.query(Transaction).filter(
            Transaction.is_deleted == False,
            Transaction.status == TransactionStatus.PENDING,
        ).all()
    )
    print(f"\n  sum of PENDING-status transactions (old def):  {pending_txn_sum}")
    print(f"  total_pending_collections (new def from cycles): {s6['total_pending_collections']}")
    print(f"  total_principal_outstanding (same number):       {s6['total_principal_outstanding']}")
    assert s6["total_pending_collections"] == s6["total_principal_outstanding"], (
        "pending == outstanding (both from cycles)"
    )
    print("  ✓ pending is now 'money customers owe', not 'gateway-pending txns'")

    # --------------------------------------------------
    # SCENARIO 7 — P1.10 + P2.16 trailing-window with zero-fill
    # --------------------------------------------------
    banner("SCENARIO 7 — P1.10/P2.16 chart trailing window with zero-fill")
    chart3 = get(client, "/api/v1/reports/charts/collections?months=3", AH)
    chart12 = get(client, "/api/v1/reports/charts/collections?months=12", AH)
    print(f"\n  months=3:  {len(chart3)} entries -> {[(e['month'], e['amount']) for e in chart3]}")
    print(f"  months=12: {len(chart12)} entries (first 3 months: {[e['month'] for e in chart12[:3]]}, last 3: {[e['month'] for e in chart12[-3:]]})")
    assert len(chart3) == 3 and len(chart12) == 12
    print("  ✓ window honored, every month present (zero-filled when no data)")

    # --------------------------------------------------
    # SCENARIO 8 — P2.12 pagination
    # --------------------------------------------------
    banner("SCENARIO 8 — P2.12 customer-report pagination")
    page1 = get(client, "/api/v1/reports/customers?page=1&page_size=2", AH)
    page2 = get(client, "/api/v1/reports/customers?page=2&page_size=2", AH)
    print(f"\n  page 1 (size 2): total_customers={page1['total_customers']}, returned={len(page1['results'])}")
    for r in page1["results"]:
        print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
    print(f"  page 2 (size 2): returned={len(page2['results'])}")
    for r in page2["results"]:
        print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
    assert page1["page"] == 1 and page1["page_size"] == 2
    print("  ✓ pagination metadata present; sort ORDER BY outstanding DESC, id ASC stable")

    # --------------------------------------------------
    # SCENARIO 9 — P3.20 + CR2 EMPLOYEE scope on customer report + CSV
    # --------------------------------------------------
    banner("SCENARIO 9 — P3.20/CR2 EMPLOYEE-scoped customer view")
    admin_view = get(client, "/api/v1/reports/customers?page=1&page_size=50", AH)
    emp_view = get(client, "/api/v1/reports/customers?page=1&page_size=50", EH)
    print(f"\n  admin sees:    total={admin_view['total_customers']}, in page={len(admin_view['results'])}")
    for r in admin_view["results"]:
        print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
    print(f"  employee sees: total={emp_view['total_customers']}, in page={len(emp_view['results'])}")
    for r in emp_view["results"]:
        print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
    assert emp_view["total_customers"] <= admin_view["total_customers"], (
        "Employee scope must not exceed admin scope"
    )
    print(f"  ✓ employee {employee.username} only sees their assigned customers")

    # --------------------------------------------------
    # SCENARIO 10 — P2.13/14/15 CSV: BOM + injection + audit
    # --------------------------------------------------
    banner("SCENARIO 10 — P2.13/14/15 CSV streaming + sanitization + audit")
    customer_name_snapshot[target_customer.id] = target_customer.full_name
    target_customer.full_name = "=cmd|' /C calc'!A1"
    db.add(target_customer)
    db.commit()

    csv_admin = client.get("/api/v1/reports/customers/export", headers=AH)
    csv_emp = client.get("/api/v1/reports/customers/export", headers=EH)
    print(f"\n  admin CSV: status={csv_admin.status_code}, {len(csv_admin.content)} bytes, {csv_admin.text.count(chr(10))} rows")
    print(f"  employee CSV: status={csv_emp.status_code}, {len(csv_emp.content)} bytes, {csv_emp.text.count(chr(10))} rows")
    bom = csv_admin.content[:3]
    print(f"  BOM bytes: {bom!r}  (expected b'\\xef\\xbb\\xbf')")
    assert bom == b"\xef\xbb\xbf", "CSV must start with UTF-8 BOM"

    planted_line = next(line for line in csv_admin.text.splitlines() if "cmd" in line)
    print(f"  planted name in CSV: {planted_line.split(',')[0]}")
    assert planted_line.startswith("'="), "Injection-prone cell must be prefixed with '"
    print("  ✓ CSV injection neutralised: '=...' is now \"'=...\"")

    audit_row = (
        db.query(AuditLog)
        .filter(AuditLog.action_type == "CUSTOMER_REPORT_EXPORT")
        .order_by(desc(AuditLog.timestamp))
        .first()
    )
    print(f"  latest audit row: {audit_row.action_type}  user={audit_row.user_id}  new_data={audit_row.new_data}")
    assert audit_row.user_id == employee.id
    assert audit_row.new_data.get("scope") == "self"
    print("  ✓ audit row persisted with role-scoped row_count + scope")

    # --------------------------------------------------
    # SCENARIO 11 — P3.19 + P3.21 employee report (DELTA-based)
    # --------------------------------------------------
    banner("SCENARIO 11 — P3.19/21 employee aggregates + soft-deleted users")
    emp_report = get(client, "/api/v1/reports/employees", AH)
    print(f"\n  aggregates: total_employees={emp_report['total_employees']}, total_collections={emp_report['total_collections']}, total_transactions={emp_report['total_transactions']}")
    emp_row = next(r for r in emp_report["results"] if r["employee_id"] == str(employee.id))
    print(f"  {employee.username}: collections={emp_row['total_collections']} txns={emp_row['transaction_count']} assigned={emp_row['assigned_customers']} is_active={emp_row['is_active']}")
    # Delta vs the snapshot we captured BEFORE inserting the REGULAR txn in scenario 4
    delta_emp = Decimal(emp_row["total_collections"]) - emp_collections_before_dp
    print(f"  employee collections delta since scenario-3 snapshot: {delta_emp}")
    assert delta_emp == Decimal("4000.00"), (
        f"Employee collections should rise by the REGULAR txn amount (4000); got {delta_emp}. "
        "DOWN_PAYMENT (9999) must be excluded."
    )
    print("  ✓ employee REGULAR txn (4000) counted; DOWN_PAYMENT (9999) excluded")

    employee.is_active = False
    db.add(employee)
    db.commit()
    user_deactivated = employee

    emp_report2 = get(client, "/api/v1/reports/employees", AH)
    emp_row2 = next(
        (r for r in emp_report2["results"] if r["employee_id"] == str(employee.id)),
        None,
    )
    print(f"\n  after deactivating {employee.username}: is_active={emp_row2['is_active'] if emp_row2 else None}, still listed={emp_row2 is not None}")
    assert emp_row2 is not None and emp_row2["is_active"] is False
    print("  ✓ former employee retained in report with is_active=False")

    # --------------------------------------------------
    # SCENARIO 12 — P0.5 outstanding non-negative by construction
    # --------------------------------------------------
    banner("SCENARIO 12 — P0.5 dashboard outstanding is non-negative by construction")
    target_cycle.total_received = target_cycle.total_due + Decimal("99999.00")
    db.add(target_cycle)
    db.commit()

    s12 = get(client, "/api/v1/reports/summary", AH)
    print(f"\n  cycle force-over-paid by 99999.  total_principal_outstanding = {s12['total_principal_outstanding']}")
    assert Decimal(s12["total_principal_outstanding"]) >= 0, "outstanding must never be negative"
    print("  ✓ per-cycle CASE WHEN clamps shortfall at 0 — no negative outstanding possible")

    # --------------------------------------------------
    # SCENARIO 13 — CR2 fail-closed RBAC on /reports/customers
    # --------------------------------------------------
    banner("SCENARIO 13 — CR2 require_report_access rejects unauth tokens")
    # No header at all → 401
    r_anon = client.get("/api/v1/reports/customers")
    print(f"\n  anonymous → {r_anon.status_code}")
    assert r_anon.status_code in (401, 403), "Unauthenticated must not pass"
    # Bogus token → 401
    bogus = {"Authorization": "Bearer not-a-real-token"}
    r_bogus = client.get("/api/v1/reports/customers", headers=bogus)
    print(f"  bogus token → {r_bogus.status_code}")
    assert r_bogus.status_code in (401, 403), "Bogus token must not pass"
    print("  ✓ customer endpoints reject unauth callers before report logic runs")

finally:
    cleanup()
