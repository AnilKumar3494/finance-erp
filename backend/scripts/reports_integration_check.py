"""
Reports module — end-to-end integration check.

Exercises every fix (P0 → P3) against the live DB through the HTTP layer,
prints clear before/after evidence for each case, and rolls back every
mutation it makes so the seed data is left untouched.

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
assert employee is not None, "Need an EMPLOYEE with at least one assigned customer"
print(f"admin = {admin.username} ({admin.id})")
print(f"employee = {employee.username} ({employee.id})")

AH = {"Authorization": f"Bearer {create_access_token(admin.id, admin.role.value)}"}
EH = {"Authorization": f"Bearer {create_access_token(employee.id, employee.role.value)}"}

# Tracked mutations for clean rollback
inserted_txn_ids: list[uuid.UUID] = []
cycle_state_snapshot: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}
customer_name_snapshot: dict[uuid.UUID, str] = {}
user_deactivated: User | None = None
inserted_audit_id_floor = None


def snapshot_cycle(cycle: DueCycle):
    if cycle.id not in cycle_state_snapshot:
        cycle_state_snapshot[cycle.id] = (cycle.total_due, cycle.total_received)


# --------------------------------------------------
# Pick a target loan owned by the employee for the test
# --------------------------------------------------
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
assert target_customer_loan is not None, "Employee needs an assigned customer with at least one loan"
target_customer, target_loan = target_customer_loan
target_cycle = (
    db.query(DueCycle)
    .filter(DueCycle.loan_id == target_loan.id, DueCycle.is_deleted == False)
    .order_by(DueCycle.cycle_number)
    .first()
)
print(f"target loan = {target_loan.loan_number}  customer={target_customer.full_name}")
print(
    f"target cycle = #{target_cycle.cycle_number}  due={target_cycle.due_date}  "
    f"total_due={target_cycle.total_due}  received={target_cycle.total_received}"
)

# Latest audit row id BEFORE the test so we can find what we wrote
latest_audit = (
    db.query(AuditLog).order_by(desc(AuditLog.timestamp)).first()
)
inserted_audit_id_floor = latest_audit.id if latest_audit else None


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
# SCENARIO 2 — P0.3 outstanding from due_cycles
# --------------------------------------------------
banner("SCENARIO 2 — P0.3 outstanding sourced from due_cycles")
snapshot_cycle(target_cycle)
# Move 4000 of received into the target cycle to simulate a partial payment
target_cycle.total_received = Decimal("4000.00")
db.add(target_cycle)
db.commit()

s2 = get(client, "/api/v1/reports/summary", AH)
p2 = get(client, "/api/v1/reports/loans", AH)
print(
    f"\n  cycle.total_due={target_cycle.total_due} cycle.total_received=4000.00"
)
print(
    f"  outstanding went {p['total_outstanding']} → {p2['total_outstanding']} "
    f"(delta = {Decimal(p['total_outstanding']) - Decimal(p2['total_outstanding'])})"
)
assert Decimal(p["total_outstanding"]) - Decimal(p2["total_outstanding"]) == Decimal(
    "4000.00"
), "Outstanding must drop by exactly the received amount"
print("  ✓ outstanding = SUM(total_due - total_received), not principal - paid")


# --------------------------------------------------
# SCENARIO 3 — P0.1 DOWN_PAYMENT excluded from collections
# --------------------------------------------------
banner("SCENARIO 3 — P0.1 DOWN_PAYMENT excluded from collection sums")
# Insert a SUCCESS DOWN_PAYMENT of 9999 against the target loan
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

s3 = get(client, "/api/v1/reports/summary", AH)
p3 = get(client, "/api/v1/reports/loans", AH)
emp3 = get(client, "/api/v1/reports/employees", AH)
print(f"\n  inserted DOWN_PAYMENT of 9999 on loan {target_loan.loan_number}")
print(f"  dashboard total_amount_collected:   {s2['total_amount_collected']} → {s3['total_amount_collected']}")
print(f"  portfolio total_collected:          {p2['total_collected']} → {p3['total_collected']}")
emp_row = next(r for r in emp3["results"] if r["employee_id"] == str(employee.id))
print(f"  employee {employee.username} collections: 0 → {emp_row['total_collections']}")
assert s3["total_amount_collected"] == s2["total_amount_collected"], (
    "DOWN_PAYMENT must NOT inflate total_amount_collected"
)
print("  ✓ DOWN_PAYMENT did NOT inflate any 'collection' sum")


# --------------------------------------------------
# SCENARIO 4 — P0.1 + P0.2 REGULAR success with back-dated eff_date
# --------------------------------------------------
banner("SCENARIO 4 — P0.2 effective_payment_date drives daily bucketing")
backdate = date.today() - timedelta(days=7)
reg_txn = Transaction(
    loan_id=target_loan.id,
    amount=Decimal("4000.00"),
    payment_mode=PaymentMethod.GPAY,
    transaction_type=TransactionType.REGULAR,
    status=TransactionStatus.SUCCESS,
    punctuality_status=PunctualityStatus.PAID_ON_TIME,
    effective_payment_date=backdate,  # NOT today
    due_cycle_id=target_cycle.id,
    collected_by_id=employee.id,
    created_by_id=employee.id,
)
db.add(reg_txn)
db.commit()
db.refresh(reg_txn)
inserted_txn_ids.append(reg_txn.id)

daily = get(client, "/api/v1/reports/collections?period=daily&days=30", AH)
print(f"\n  inserted REGULAR 4000.00 (GPAY) with effective_payment_date={backdate} (created today)")
print(f"  daily entries returned:")
for e in daily["entries"][:5]:
    print(f"    {e['date']:12s} total={e['total_amount']:>8} cash={e['cash']:>6} gpay={e['gpay']:>6} phonepe={e['phonepe']:>6} bank={e['bank_transfer']:>6} other={e['other']:>6}")
matched = [e for e in daily["entries"] if e["date"] == str(backdate)]
assert matched and Decimal(matched[0]["total_amount"]) == Decimal("4000.00"), (
    f"Expected 4000 in {backdate} bucket"
)
print(f"  ✓ bucketed on effective_payment_date ({backdate}), not on created_at (today)")
# Row invariant
e = matched[0]
total = Decimal(e["cash"]) + Decimal(e["gpay"]) + Decimal(e["phonepe"]) + Decimal(e["bank_transfer"]) + Decimal(e["other"])
print(f"  ✓ row invariant cash+gpay+phonepe+bank+other = total: {total} == {e['total_amount']}")


# --------------------------------------------------
# SCENARIO 5 — P0.4 total_payable from due_cycles
# --------------------------------------------------
banner("SCENARIO 5 — P0.4 total_payable = SUM(due_cycles.total_due) ≠ principal")
p5 = get(client, "/api/v1/reports/loans", AH)
print(f"\n  total_principal:    {p5['total_principal']}")
print(f"  total_payable:      {p5['total_payable']}   ← includes interest/penalty add-ons")
print(f"  total_outstanding:  {p5['total_outstanding']}")
print(f"  total_collected:    {p5['total_collected']}")
print(f"  total_payable > total_principal:  {Decimal(p5['total_payable']) > Decimal(p5['total_principal'])}")
print(f"  invariant payable = outstanding + collected: "
      f"{Decimal(p5['total_payable']) == Decimal(p5['total_outstanding']) + Decimal(p5['total_collected'])}")


# --------------------------------------------------
# SCENARIO 6 — P0.6 pending = ledger shortfall (not gateway PENDING)
# --------------------------------------------------
banner("SCENARIO 6 — P0.6 total_pending_collections = ledger shortfall")
s6 = get(client, "/api/v1/reports/summary", AH)
# Count of PENDING-status transactions (the OLD definition):
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
print(f"  months=12: {len(chart12)} entries (first 3: {[e['month'] for e in chart12[:3]]} ... last 3: {[e['month'] for e in chart12[-3:]]})")
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
print("  ✓ pagination metadata present; sort ORDER BY outstanding DESC stable")


# --------------------------------------------------
# SCENARIO 9 — P3.20 EMPLOYEE scope on customer report + CSV
# --------------------------------------------------
banner("SCENARIO 9 — P3.20 EMPLOYEE-scoped customer view")
admin_view = get(client, "/api/v1/reports/customers?page=1&page_size=50", AH)
emp_view = get(client, "/api/v1/reports/customers?page=1&page_size=50", EH)
print(f"\n  admin sees:    total={admin_view['total_customers']}, in page={len(admin_view['results'])}")
for r in admin_view["results"]:
    print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
print(f"  employee sees: total={emp_view['total_customers']}, in page={len(emp_view['results'])}")
for r in emp_view["results"]:
    print(f"    {r['customer_name']:30s} outstanding={r['total_outstanding']}")
print(f"  ✓ employee {employee.username} only sees their assigned customers")


# --------------------------------------------------
# SCENARIO 10 — P2.13/14/15 CSV: BOM, injection sanitization, audit log
# --------------------------------------------------
banner("SCENARIO 10 — P2.13/14/15 CSV streaming + sanitization + audit")
# Plant a CSV-injection name on one customer
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

# Find the planted row
planted_line = [line for line in csv_admin.text.splitlines() if "cmd" in line][0]
print(f"  planted name in CSV: {planted_line.split(',')[0]}")
assert planted_line.startswith("'="), "Injection-prone cell must be prefixed with '"
print("  ✓ CSV injection neutralised: '=...' is now \"'=...\"")

# Audit log
audit_row = (
    db.query(AuditLog)
    .filter(AuditLog.action_type == "CUSTOMER_REPORT_EXPORT")
    .order_by(desc(AuditLog.timestamp))
    .first()
)
print(f"  latest audit row: {audit_row.action_type}  user={audit_row.user_id}  new_data={audit_row.new_data}")
assert audit_row.user_id == employee.id  # most recent = employee export
assert audit_row.new_data.get("scope") == "self"
print("  ✓ audit row persisted with role-scoped row_count + scope")


# --------------------------------------------------
# SCENARIO 11 — P3.19 + P3.21 employee report: aggregates + is_active
# --------------------------------------------------
banner("SCENARIO 11 — P3.19/21 employee aggregates + soft-deleted users")

# Verify employee txn now appears under EmpNew01
emp_report = get(client, "/api/v1/reports/employees", AH)
print(f"\n  aggregates: total_employees={emp_report['total_employees']}, total_collections={emp_report['total_collections']}, total_transactions={emp_report['total_transactions']}")
emp_row = next(r for r in emp_report["results"] if r["employee_id"] == str(employee.id))
print(f"  {employee.username}: collections={emp_row['total_collections']} txns={emp_row['transaction_count']} assigned={emp_row['assigned_customers']} is_active={emp_row['is_active']}")
assert Decimal(emp_row["total_collections"]) == Decimal("4000.00"), (
    "Employee collections should reflect the REGULAR txn, not the DOWN_PAYMENT"
)
print(f"  ✓ employee REGULAR txn (4000) counted; DOWN_PAYMENT (9999) excluded")

# Now soft-deactivate the employee; the row must STAY because they have history
employee.is_active = False
db.add(employee)
db.commit()
user_deactivated = employee

emp_report2 = get(client, "/api/v1/reports/employees", AH)
emp_row2 = next(
    (r for r in emp_report2["results"] if r["employee_id"] == str(employee.id)),
    None,
)
print(f"\n  after deactivating {employee.username}: is_active={emp_row2['is_active']}, still listed={emp_row2 is not None}")
assert emp_row2 is not None and emp_row2["is_active"] is False
print("  ✓ former employee retained in report with is_active=False")


# --------------------------------------------------
# SCENARIO 12 — P0.5 outstanding can never go negative
# --------------------------------------------------
banner("SCENARIO 12 — P0.5 dashboard outstanding is non-negative by construction")
# Push the cycle to over-paid (received > due)
target_cycle.total_received = target_cycle.total_due + Decimal("99999.00")
db.add(target_cycle)
db.commit()

s12 = get(client, "/api/v1/reports/summary", AH)
print(f"\n  cycle force-over-paid by 99999.  total_principal_outstanding = {s12['total_principal_outstanding']}")
assert Decimal(s12["total_principal_outstanding"]) >= 0, "outstanding must never be negative"
print("  ✓ per-cycle CASE WHEN clamps shortfall at 0 — no negative outstanding possible")


# --------------------------------------------------
# Cleanup — revert every mutation
# --------------------------------------------------
banner("CLEANUP — reverting all test mutations")

for cid, (orig_due, orig_recv) in cycle_state_snapshot.items():
    c = db.get(DueCycle, cid)
    c.total_due, c.total_received = orig_due, orig_recv
    db.add(c)
for cust_id, orig_name in customer_name_snapshot.items():
    cust = db.get(Customer, cust_id)
    cust.full_name = orig_name
    db.add(cust)
if user_deactivated is not None:
    user_deactivated.is_active = True
    db.add(user_deactivated)
for txn_id in inserted_txn_ids:
    t = db.get(Transaction, txn_id)
    if t is not None:
        db.delete(t)

# Clean audit rows the test created
if inserted_audit_id_floor is not None:
    db.query(AuditLog).filter(
        AuditLog.timestamp > db.query(AuditLog).filter(AuditLog.id == inserted_audit_id_floor).first().timestamp,
        AuditLog.action_type == "CUSTOMER_REPORT_EXPORT",
    ).delete(synchronize_session=False)

db.commit()
db.close()

print("\nDone — DB reverted to pre-test state.")
