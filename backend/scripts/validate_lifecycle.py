"""
End-to-end validation against the dev DB.
Every documented scenario is run with the spec's expected numbers.
"""
import logging
import main  # registers all mappers + routes

from datetime import date, timedelta
from decimal import Decimal
from typing import List

from app.core.db import SessionLocal
from app.models.audit_log import AuditLog
from app.models.bad_debt_proposal import BadDebtProposal, BadDebtProposalStatus
from app.models.customer import Customer
from app.models.due_cycle import CycleStatus, DueCycle
from app.models.loan import Loan, LoanStatus
from app.models.loan_closure import ClosureType, LoanClosure
from app.models.penalty_event import PenaltyEvent
from app.models.transaction import PunctualityStatus, Transaction, TransactionStatus
from app.models.user import User
from app.schemas.due_cycle import CycleClassifyRequest
from app.schemas.loan import LoanCreate
from app.schemas.loan_closure import LoanCloseRequest
from app.schemas.transaction import TransactionCreate
from app.services.bad_debt import propose_bad_debt, review_proposal
from app.services.loan import approve_loan, create_loan, soft_delete_loan, update_loan
from app.schemas.loan import LoanUpdate
from app.services.loan_closure import close_loan as close_loan_with_closure
from app.services.penalty import apply_penalty, mark_cycle_paid_on_time, reclassify_cycle
from app.services.transaction import confirm_transaction, create_transaction, get_loan_transaction_summary
from app.jobs.nightly_cycle_check import run_once
from app.api.v1.routes.due_cycles import classify_cycle, reclassify_cycle_route
from app.api.v1.routes.transactions import _assert_loan_in_user_scope
from fastapi import HTTPException


logging.basicConfig(level=logging.ERROR)  # silence the WARN noise from the cap path

DB = SessionLocal()
ALL_LOAN_IDS: List = []
PASS = 0
FAIL = 0
RESULTS = []


def section(title):
    print()
    print("=" * 72)
    print(f"  {title}")
    print("=" * 72)


def check(label, got, expected, tol=Decimal("0.00")):
    global PASS, FAIL
    if isinstance(got, Decimal) and isinstance(expected, Decimal):
        ok = abs(got - expected) <= tol
    else:
        ok = got == expected
    if ok:
        PASS += 1
        print(f"  ✓ {label}: {got}")
    else:
        FAIL += 1
        print(f"  ✗ {label}: got={got}  expected={expected}")
    RESULTS.append((ok, label))


def fresh_loan(principal="48000", rate="25", tenure=12, dp="0", dp_mode=None,
               processing="0", doc="0"):
    cust = DB.query(Customer).filter(Customer.is_deleted == False).first()
    user = DB.query(User).filter(User.is_deleted == False).first()
    loan = create_loan(DB, LoanCreate(
        customer_id=cust.id, principal=Decimal(principal),
        interest_rate=Decimal(rate), tenure=tenure,
        down_payment=Decimal(dp),
        processing_fee=Decimal(processing),
        documentation_fee=Decimal(doc),
        down_payment_mode=dp_mode,
    ), created_by=user.id)
    loan = approve_loan(DB, loan, approved_by=user.id, down_payment_mode=dp_mode)
    ALL_LOAN_IDS.append(loan.id)
    cycles = (DB.query(DueCycle).filter(DueCycle.loan_id == loan.id)
              .order_by(DueCycle.cycle_number).all())
    return loan, cycles, user


def cleanup():
    for lid in ALL_LOAN_IDS:
        cycle_ids = [c.id for c in DB.query(DueCycle).filter(DueCycle.loan_id == lid).all()]
        if cycle_ids:
            DB.query(AuditLog).filter(
                AuditLog.target_table == 'due_cycles',
                AuditLog.record_id.in_(cycle_ids),
            ).delete(synchronize_session=False)
        DB.query(BadDebtProposal).filter(BadDebtProposal.loan_id == lid).delete()
        DB.query(LoanClosure).filter(LoanClosure.loan_id == lid).delete()
        DB.query(PenaltyEvent).filter(PenaltyEvent.loan_id == lid).delete()
        DB.query(Transaction).filter(Transaction.loan_id == lid).delete()
        DB.query(DueCycle).filter(DueCycle.loan_id == lid).delete()
        DB.query(Loan).filter(Loan.id == lid).delete()
    DB.commit()


try:
    # ======================================================================
    section("SETUP — sample loan from the spec")
    # ======================================================================
    loan, cycles, user = fresh_loan()
    print(f"  Principal ₹48,000 · Rate 25% · Tenure 12 · Approval {loan.approval_date}")
    print(f"  EMI cycle 1: due {cycles[0].due_date}, base {cycles[0].base_emi}")
    print(f"  EMI cycle 12: due {cycles[-1].due_date}, base {cycles[-1].base_emi}")
    check("12 cycles generated", len(cycles), 12)
    check("Sum of base_emi", sum(c.base_emi for c in cycles), Decimal("60000.00"))
    check("Loan status post-approval", loan.status, LoanStatus.ACTIVE)
    check("Approval date stamped", loan.approval_date is not None, True)
    check("due_day_of_month captured", loan.due_day_of_month, loan.approval_date.day)

    # ======================================================================
    section("EXAMPLE A — pay exact EMI every month, all on time")
    # ======================================================================
    for c in cycles:
        t = create_transaction(DB, TransactionCreate(
            loan_id=loan.id, amount=c.base_emi, payment_mode='CASH',
            effective_payment_date=c.due_date - timedelta(days=1),
        ), created_by=user.id)
        confirm_transaction(DB, t, updated_by=user.id)
    DB.refresh(loan)
    summary = get_loan_transaction_summary(DB, loan)
    print(f"  outstanding={summary['outstanding']}  total_paid={summary['total_paid']}  status={loan.status.value}")
    check("Outstanding after 12 EMIs", summary["outstanding"], Decimal("0.00"))
    check("Total paid", summary["total_paid"], Decimal("60000.00"))
    check("Status = AWAITING_CLOSURE (no auto-close)", loan.status, LoanStatus.AWAITING_CLOSURE)

    # ======================================================================
    section("EXAMPLE B — with down payment ₹12,000 (Alternative A)")
    # ======================================================================
    loan_b, cycles_b, _ = fresh_loan(dp="12000", dp_mode="CASH")
    dp_txn = DB.query(Transaction).filter(
        Transaction.loan_id == loan_b.id,
        Transaction.transaction_type == 'DOWN_PAYMENT',
    ).first()
    DB.refresh(cycles_b[0])
    summary_b = get_loan_transaction_summary(DB, loan_b)
    print(f"  total_payable={summary_b['total_payable']}  cycle1.total_received={cycles_b[0].total_received}")
    check("Total payable unchanged (interest on full principal)", summary_b["total_payable"], Decimal("60000.00"))
    check("DP txn punctuality", dp_txn.punctuality_status, PunctualityStatus.PAID_ON_TIME)
    check("DP txn allocated to cycle 1", dp_txn.due_cycle_id, cycles_b[0].id)
    check("Cycle 1 total_received = DP amount", cycles_b[0].total_received, Decimal("12000.00"))

    # ======================================================================
    section("EXAMPLE C — with fees ₹2,000 processing + ₹1,000 documentation")
    # ======================================================================
    loan_c, cycles_c, _ = fresh_loan(processing="2000", doc="1000")
    summary_c = get_loan_transaction_summary(DB, loan_c)
    net_disbursed = loan_c.principal - loan_c.down_payment - loan_c.processing_fee - loan_c.documentation_fee
    print(f"  net disbursed (cash to customer)={net_disbursed}  total_payable={summary_c['total_payable']}")
    check("Net disbursed = principal − fees", net_disbursed, Decimal("45000.00"))
    check("Total payable unchanged (fees not financed)", summary_c["total_payable"], Decimal("60000.00"))

    # ======================================================================
    section("EXAMPLE D — partial late: 3,000 on time, 2,000 paid 5 days late")
    # ======================================================================
    loan_d, cycles_d, _ = fresh_loan()
    c1d = cycles_d[0]
    t1 = create_transaction(DB, TransactionCreate(
        loan_id=loan_d.id, amount=Decimal('3000'), payment_mode='CASH',
        effective_payment_date=c1d.due_date - timedelta(days=1),
    ), created_by=user.id)
    confirm_transaction(DB, t1, updated_by=user.id)
    t2 = create_transaction(DB, TransactionCreate(
        loan_id=loan_d.id, amount=Decimal('2000'), payment_mode='CASH',
        effective_payment_date=c1d.due_date + timedelta(days=5),  # late → default M2
    ), created_by=user.id)
    confirm_transaction(DB, t2, updated_by=user.id)
    DB.refresh(c1d); DB.refresh(cycles_d[1])
    print(f"  M1 shortfall before classify: {c1d.total_due - c1d.total_received}")
    print(f"  M2 allocated late credit: {cycles_d[1].total_received}")

    resp = classify_cycle(
        cycle_id=c1d.id,
        payload=CycleClassifyRequest(
            cycle_status=CycleStatus.LATE_PAYMENT,
            classified_as_of_date=c1d.due_date + timedelta(days=5),
        ),
        db=DB, current_user=user,
    )
    DB.refresh(c1d); [DB.refresh(c) for c in cycles_d]
    summary_d = get_loan_transaction_summary(DB, loan_d)
    print(f"  M1 penalty={resp.penalty_event.penalty_amount}  spread/month={resp.penalty_event.spread_per_month}")
    print(f"  M2 new total_due={cycles_d[1].total_due}  loan total_payable={summary_d['total_payable']}")
    check("Penalty (2000 × 36% × 5/30)", resp.penalty_event.penalty_amount, Decimal("120.00"))
    check("Spread per month (2120/11)", resp.penalty_event.spread_per_month, Decimal("192.73"))
    check("M2 new total_due", cycles_d[1].total_due, Decimal("5192.73"))
    check("Sum of addons over M2..M12", sum(c.addon_from_penalties for c in cycles_d), Decimal("2120.00"))
    check("Loan total_payable", summary_d["total_payable"], Decimal("60120.00"))
    check("Cycle 1 status", c1d.cycle_status, CycleStatus.LATE_PAYMENT)
    check("T1 punctuality propagated", DB.query(Transaction).filter(Transaction.id == t1.id).one().punctuality_status, PunctualityStatus.LATE_PAYMENT)

    # ======================================================================
    section("EXAMPLE F — fully missed M1, classified 20 days late")
    # ======================================================================
    loan_f, cycles_f, _ = fresh_loan()
    c1f = cycles_f[0]
    resp_f = classify_cycle(
        cycle_id=c1f.id,
        payload=CycleClassifyRequest(
            cycle_status=CycleStatus.LATE_PAYMENT,
            classified_as_of_date=c1f.due_date + timedelta(days=20),
        ),
        db=DB, current_user=user,
    )
    DB.refresh(cycles_f[1]); summary_f = get_loan_transaction_summary(DB, loan_f)
    print(f"  penalty={resp_f.penalty_event.penalty_amount}  spread={resp_f.penalty_event.spread_per_month}  M2 total_due={cycles_f[1].total_due}")
    check("Penalty (5000 × 36% × 20/30)", resp_f.penalty_event.penalty_amount, Decimal("1200.00"))
    check("Spread per month (6200/11)", resp_f.penalty_event.spread_per_month, Decimal("563.64"))
    check("M2 new total_due", cycles_f[1].total_due, Decimal("5563.64"))
    check("Loan total_payable", summary_f["total_payable"], Decimal("61200.00"))

    # ======================================================================
    section("EXAMPLE I — short month: 5,000 late 5 days in Feb (28 days)")
    # ======================================================================
    loan_i, cycles_i, _ = fresh_loan()
    feb_cycle = next((c for c in cycles_i if c.due_date.month == 2), None)
    if feb_cycle is None:
        # If our approval date doesn't produce a Feb cycle, pick the cycle that does
        feb_cycle = min(cycles_i, key=lambda c: 0 if c.due_date.month == 2 else 1)
    resp_i = classify_cycle(
        cycle_id=feb_cycle.id,
        payload=CycleClassifyRequest(
            cycle_status=CycleStatus.LATE_PAYMENT,
            classified_as_of_date=feb_cycle.due_date + timedelta(days=5),
        ),
        db=DB, current_user=user,
    )
    print(f"  due={feb_cycle.due_date}  days_in_due_month={resp_i.penalty_event.days_in_due_month}  penalty={resp_i.penalty_event.penalty_amount}")
    if resp_i.penalty_event.days_in_due_month == 28:
        check("Feb non-leap penalty (5000 × 36% × 5/28)", resp_i.penalty_event.penalty_amount, Decimal("321.43"))
    elif resp_i.penalty_event.days_in_due_month == 29:
        check("Feb leap penalty (5000 × 36% × 5/29)", resp_i.penalty_event.penalty_amount, Decimal("310.34"), tol=Decimal("0.01"))

    # ======================================================================
    section("EXAMPLE — cap hit (100 days late on 30-day month)")
    # ======================================================================
    loan_cap, cycles_cap, _ = fresh_loan()
    c1cap = cycles_cap[0]
    resp_cap = classify_cycle(
        cycle_id=c1cap.id,
        payload=CycleClassifyRequest(
            cycle_status=CycleStatus.LATE_PAYMENT,
            classified_as_of_date=c1cap.due_date + timedelta(days=100),
        ),
        db=DB, current_user=user,
    )
    DB.refresh(c1cap)
    prop = DB.query(BadDebtProposal).filter(BadDebtProposal.loan_id == loan_cap.id).first()
    DB.refresh(loan_cap)
    print(f"  penalty={resp_cap.penalty_event.penalty_amount}  cap_hit={resp_cap.penalty_event.cap_hit}  cycle_status={c1cap.cycle_status.value}  loan_status={loan_cap.status.value}")
    check("Penalty capped at 100% of late amount", resp_cap.penalty_event.penalty_amount, Decimal("5000.00"))
    check("cap_hit flag", resp_cap.penalty_event.cap_hit, True)
    check("Cycle status MISSED_CAPPED", c1cap.cycle_status, CycleStatus.MISSED_CAPPED)
    check("Auto-proposed bad debt", prop is not None and prop.auto_proposed, True)
    check("Loan moved to BAD_DEBT_PROPOSED", loan_cap.status, LoanStatus.BAD_DEBT_PROPOSED)

    # ======================================================================
    section("EXAMPLE J — reclassify: LATE → LATE (later date)")
    # ======================================================================
    loan_j, cycles_j, _ = fresh_loan()
    c1j = cycles_j[0]
    t1 = create_transaction(DB, TransactionCreate(
        loan_id=loan_j.id, amount=Decimal('3000'), payment_mode='CASH',
        effective_payment_date=c1j.due_date - timedelta(days=1),
    ), created_by=user.id)
    confirm_transaction(DB, t1, updated_by=user.id)
    classify_cycle(c1j.id, CycleClassifyRequest(
        cycle_status=CycleStatus.LATE_PAYMENT,
        classified_as_of_date=c1j.due_date + timedelta(days=5),
    ), db=DB, current_user=user)
    DB.refresh(c1j)
    print(f"  After first classify (5 days):  penalty={c1j.penalty_amount}")
    reclassify_cycle_route(
        cycle_id=c1j.id,
        payload=CycleClassifyRequest(
            cycle_status=CycleStatus.LATE_PAYMENT,
            classified_as_of_date=c1j.due_date + timedelta(days=10),
        ),
        db=DB, current_user=user,
    )
    DB.refresh(c1j); [DB.refresh(c) for c in cycles_j]
    summary_j = get_loan_transaction_summary(DB, loan_j)
    events = DB.query(PenaltyEvent).filter(PenaltyEvent.loan_id == loan_j.id).order_by(PenaltyEvent.created_at).all()
    audit = DB.query(AuditLog).filter(AuditLog.action_type == 'CYCLE_RECLASSIFY', AuditLog.record_id == c1j.id).first()
    print(f"  After reclassify (10 days): penalty={c1j.penalty_amount}  M2 total_due={cycles_j[1].total_due}  total_payable={summary_j['total_payable']}")
    check("Penalty 240 (2000 × 36% × 10/30)", c1j.penalty_amount, Decimal("240.00"))
    check("M2 new total_due (5000 + 2240/11)", cycles_j[1].total_due, Decimal("5203.64"))
    check("Loan total_payable", summary_j["total_payable"], Decimal("60240.00"))
    check("Two penalty_event rows (old superseded, new active)", len(events), 2)
    check("Old event superseded_by new", events[0].superseded_by_id, events[1].id)
    check("Audit log row written", audit is not None, True)

    # ======================================================================
    section("EXAMPLE — reclassify LATE → PAID_ON_TIME after settling shortfall")
    # ======================================================================
    loan_k, cycles_k, _ = fresh_loan()
    c1k = cycles_k[0]
    t1 = create_transaction(DB, TransactionCreate(
        loan_id=loan_k.id, amount=Decimal('3000'), payment_mode='CASH',
        effective_payment_date=c1k.due_date - timedelta(days=1),
    ), created_by=user.id)
    confirm_transaction(DB, t1, updated_by=user.id)
    t2 = create_transaction(DB, TransactionCreate(
        loan_id=loan_k.id, amount=Decimal('2000'), payment_mode='CASH',
        effective_payment_date=c1k.due_date + timedelta(days=5),
    ), created_by=user.id)
    confirm_transaction(DB, t2, updated_by=user.id)
    classify_cycle(c1k.id, CycleClassifyRequest(
        cycle_status=CycleStatus.LATE_PAYMENT,
        classified_as_of_date=c1k.due_date + timedelta(days=5),
    ), db=DB, current_user=user)
    # Settle the shortfall by paying extra 2000 forced to M1
    t3 = create_transaction(DB, TransactionCreate(
        loan_id=loan_k.id, amount=Decimal('2000'), payment_mode='CASH',
        effective_payment_date=c1k.due_date, due_cycle_id=c1k.id,
    ), created_by=user.id)
    confirm_transaction(DB, t3, updated_by=user.id)
    reclassify_cycle_route(c1k.id, CycleClassifyRequest(
        cycle_status=CycleStatus.PAID_ON_TIME,
        classification_note="Customer cleared the shortfall.",
    ), db=DB, current_user=user)
    DB.refresh(c1k); [DB.refresh(c) for c in cycles_k]
    summary_k = get_loan_transaction_summary(DB, loan_k)
    ev = DB.query(PenaltyEvent).filter(PenaltyEvent.loan_id == loan_k.id).first()
    print(f"  Cycle status: {c1k.cycle_status.value}  penalty={c1k.penalty_amount}  M2 total_due={cycles_k[1].total_due}  total_payable={summary_k['total_payable']}")
    check("Cycle now PAID_ON_TIME", c1k.cycle_status, CycleStatus.PAID_ON_TIME)
    check("Penalty zeroed", c1k.penalty_amount, Decimal("0.00"))
    check("M2 addon zeroed", cycles_k[1].addon_from_penalties, Decimal("0.00"))
    check("M2 total_due reverted", cycles_k[1].total_due, Decimal("5000.00"))
    check("Total payable returned to base", summary_k["total_payable"], Decimal("60000.00"))
    check("Old penalty_event self-superseded (sentinel)", ev.superseded_by_id, ev.id)

    # ======================================================================
    section("EXAMPLE K — early foreclosure + admin close")
    # ======================================================================
    loan_fc, cycles_fc, _ = fresh_loan()
    c1fc = cycles_fc[0]
    t = create_transaction(DB, TransactionCreate(
        loan_id=loan_fc.id, amount=Decimal('60000'), payment_mode='CASH',
        effective_payment_date=c1fc.due_date - timedelta(days=1),
    ), created_by=user.id)
    confirm_transaction(DB, t, updated_by=user.id)
    DB.refresh(loan_fc)
    check("Foreclosure: status before close", loan_fc.status, LoanStatus.AWAITING_CLOSURE)
    closure = close_loan_with_closure(DB, loan=loan_fc, data=LoanCloseRequest(
        closure_type=ClosureType.EARLY_FORECLOSURE,
        final_settlement_amount=Decimal('0'),
        noc_issued=True, noc_reference='NOC-FC-001',
    ), closed_by=user.id)
    DB.commit(); DB.refresh(loan_fc)
    print(f"  closure_type={closure.closure_type.value}  NOC={closure.noc_reference}")
    check("Foreclosure: status after close", loan_fc.status, LoanStatus.CLOSED)
    check("NOC reference recorded", closure.noc_reference, "NOC-FC-001")

    # ======================================================================
    section("NEGOTIATED_SETTLEMENT — 50% recovery, 50% written off")
    # ======================================================================
    loan_n, cycles_n, _ = fresh_loan()
    closure_n = close_loan_with_closure(DB, loan=loan_n, data=LoanCloseRequest(
        closure_type=ClosureType.NEGOTIATED_SETTLEMENT,
        final_settlement_amount=Decimal('30000'),
        amount_written_off=Decimal('30000'),
        closure_remarks="50% settlement agreed.",
    ), closed_by=user.id)
    DB.commit(); DB.refresh(loan_n)
    print(f"  status={loan_n.status.value}  written_off={closure_n.amount_written_off}  collected={closure_n.final_settlement_amount}")
    check("Settlement loan → CLOSED", loan_n.status, LoanStatus.CLOSED)
    check("Amount written off matches arithmetic", closure_n.amount_written_off, Decimal("30000.00"))

    # ======================================================================
    section("WRITE_OFF — bad debt write-off")
    # ======================================================================
    loan_w, cycles_w, _ = fresh_loan()
    summary_w = get_loan_transaction_summary(DB, loan_w)
    closure_w = close_loan_with_closure(DB, loan=loan_w, data=LoanCloseRequest(
        closure_type=ClosureType.WRITE_OFF,
        final_settlement_amount=Decimal('0'),
        amount_written_off=summary_w['outstanding'],
        closure_remarks='No recovery possible.',
    ), closed_by=user.id)
    DB.commit(); DB.refresh(loan_w)
    print(f"  status={loan_w.status.value}  written_off={closure_w.amount_written_off}")
    check("WRITE_OFF → BAD_DEBT terminal", loan_w.status, LoanStatus.BAD_DEBT)

    # ======================================================================
    section("BAD-DEBT proposal flow")
    # ======================================================================
    # Manual propose → REJECT
    loan_p1, _, _ = fresh_loan()
    p1 = propose_bad_debt(DB, loan_p1, proposed_by=user.id, reason="Customer unresponsive for 60 days.")
    DB.commit(); DB.refresh(loan_p1)
    check("Manual propose: loan → BAD_DEBT_PROPOSED", loan_p1.status, LoanStatus.BAD_DEBT_PROPOSED)
    check("Proposal auto_proposed=False", p1.auto_proposed, False)
    review_proposal(DB, p1, loan_p1, decision="REJECT", reviewer_id=user.id, review_notes="Customer responded.")
    DB.commit(); DB.refresh(loan_p1); DB.refresh(p1)
    check("Reject: loan reverts to ACTIVE", loan_p1.status, LoanStatus.ACTIVE)
    check("Proposal status REJECTED", p1.status, BadDebtProposalStatus.REJECTED)

    # Manual propose → APPROVE
    loan_p2, _, _ = fresh_loan()
    p2 = propose_bad_debt(DB, loan_p2, proposed_by=user.id, reason="Confirmed bad debt after collection efforts.")
    DB.commit()
    review_proposal(DB, p2, loan_p2, decision="APPROVE", reviewer_id=user.id)
    DB.commit(); DB.refresh(loan_p2); DB.refresh(p2)
    check("Approve: loan stays BAD_DEBT_PROPOSED awaiting WRITE_OFF", loan_p2.status, LoanStatus.BAD_DEBT_PROPOSED)
    check("Proposal status APPROVED", p2.status, BadDebtProposalStatus.APPROVED)

    # ======================================================================
    section("NIGHTLY JOB — backdate a loan, run job, verify promotions + auto-cap")
    # ======================================================================
    loan_nj, cycles_nj, _ = fresh_loan()
    loan_nj.approval_date = date.today() - timedelta(days=120)
    for c in cycles_nj:
        c.due_date = c.due_date - timedelta(days=120)
    DB.commit()
    totals = run_once(db=DB)
    DB.refresh(cycles_nj[0]); DB.refresh(loan_nj)
    prop_nj = DB.query(BadDebtProposal).filter(BadDebtProposal.loan_id == loan_nj.id).first()
    print(f"  totals={totals}")
    print(f"  M1 status={cycles_nj[0].cycle_status.value}  penalty={cycles_nj[0].penalty_amount}  loan.status={loan_nj.status.value}  bad_debt_proposed={prop_nj is not None}")
    check("Nightly job promoted ≥1 cycle to AWAITING_REVIEW", totals['promoted_to_awaiting_review'] >= 1, True)
    check("Nightly job auto-capped ≥1 cycle", totals['auto_classified_at_cap'] >= 1, True)
    check("M1 cycle MISSED_CAPPED", cycles_nj[0].cycle_status, CycleStatus.MISSED_CAPPED)
    check("Loan now BAD_DEBT_PROPOSED", loan_nj.status, LoanStatus.BAD_DEBT_PROPOSED)
    check("Auto bad-debt proposal exists with auto=True", prop_nj is not None and prop_nj.auto_proposed, True)
    check("No errors in nightly job", totals['errors'], 0)

    # ======================================================================
    section("GUARDS — DP must be < principal")
    # ======================================================================
    try:
        bad = create_loan(DB, LoanCreate(
            customer_id=DB.query(Customer).filter(Customer.is_deleted == False).first().id,
            principal=Decimal('48000'), interest_rate=Decimal('25'), tenure=12,
            down_payment=Decimal('48000'), down_payment_mode='CASH',
        ), created_by=user.id)
        # If we get here, the guard failed
        ALL_LOAN_IDS.append(bad.id)
        check("DP = principal rejected", False, True)
    except Exception as e:
        DB.rollback()
        check("DP = principal rejected", "Down payment must be strictly less than principal" in str(e), True)

    # ======================================================================
    section("GUARDS — overpayment accepted, admin note auto-attached")
    # ======================================================================
    loan_op, cycles_op, _ = fresh_loan()
    c_op = cycles_op[0]
    # Pay almost-full first so the loan stays ACTIVE
    t = create_transaction(DB, TransactionCreate(
        loan_id=loan_op.id, amount=Decimal('59500'), payment_mode='CASH',
        effective_payment_date=c_op.due_date - timedelta(days=1),
    ), created_by=user.id)
    confirm_transaction(DB, t, updated_by=user.id)
    DB.refresh(loan_op)
    # outstanding = 500. Now overpay 1,000 (excess 500).
    over = create_transaction(DB, TransactionCreate(
        loan_id=loan_op.id, amount=Decimal('1000'), payment_mode='CASH',
        effective_payment_date=c_op.due_date,
    ), created_by=user.id)
    DB.refresh(over)
    print(f"  Overpay txn id={over.id}  amount={over.amount}  notes='{(over.notes or '')[:100]}...'")
    check("Overpay txn was created (not rejected)", over is not None, True)
    check("Overpay txn auto-tagged with ADMIN NOTE", "[ADMIN NOTE]" in (over.notes or ""), True)
    check("Note mentions the excess amount (500)", "500" in (over.notes or ""), True)

    # ======================================================================
    section("GUARDS — edit blocked on non-ACTIVE/DRAFT loan")
    # ======================================================================
    # loan_fc is CLOSED. Try to edit.
    try:
        update_loan(DB, loan=loan_fc, data=LoanUpdate(interest_rate=Decimal('30')), updated_by=user.id)
        check("Edit CLOSED loan blocked", False, True)
    except Exception as e:
        DB.rollback()
        check("Edit CLOSED loan blocked (service)", True, True)

    # ======================================================================
    section("AUDIT FIXES — idempotency scoping, deleted_by_id, RBAC")
    # ======================================================================
    # Idempotency: same key on two different loans -> two distinct txns
    loan_a1, _, _ = fresh_loan()
    loan_a2, _, _ = fresh_loan()
    txa = create_transaction(DB, TransactionCreate(
        loan_id=loan_a1.id, amount=Decimal('100'), payment_mode='CASH',
        idempotency_key='dup-test-key',
    ), created_by=user.id)
    txb = create_transaction(DB, TransactionCreate(
        loan_id=loan_a2.id, amount=Decimal('100'), payment_mode='CASH',
        idempotency_key='dup-test-key',
    ), created_by=user.id)
    check("Idempotency: same key, different loans → 2 txns", txa.id != txb.id, True)
    # Same key, same loan returns the existing
    txa_dup = create_transaction(DB, TransactionCreate(
        loan_id=loan_a1.id, amount=Decimal('100'), payment_mode='CASH',
        idempotency_key='dup-test-key',
    ), created_by=user.id)
    check("Idempotency: same key, same loan → returns existing", txa_dup.id, txa.id)

    # Soft-delete sets deleted_by_id
    soft_delete_loan(DB, loan_a1, deleted_by=user.id)
    DB.refresh(loan_a1)
    check("Soft-delete sets deleted_by_id", loan_a1.deleted_by_id, user.id)

    # RBAC: employee scope check.
    # Need an EMPLOYEE user that is NOT the assigned_employee_id of the
    # loan we just created (otherwise they DO have access — which is correct).
    loan_rbac, _, _ = fresh_loan()
    cust_for_loan = DB.query(Customer).filter(Customer.id == loan_rbac.customer_id).first()
    other_employee = DB.query(User).filter(
        User.role == 'EMPLOYEE',
        User.is_deleted == False,
        User.id != cust_for_loan.assigned_employee_id,
    ).first()
    if other_employee is None:
        print("  (no UNRELATED employee user in DB — RBAC test skipped)")
    else:
        try:
            _assert_loan_in_user_scope(DB, loan_rbac.id, other_employee)
            check("RBAC: unrelated employee blocked from loan", False, True)
        except HTTPException as he:
            check("RBAC: unrelated employee blocked from loan", he.status_code, 403)
        # And the *assigned* employee SHOULD be allowed
        assigned_employee = DB.query(User).filter(
            User.id == cust_for_loan.assigned_employee_id
        ).first()
        if assigned_employee is not None:
            try:
                got = _assert_loan_in_user_scope(DB, loan_rbac.id, assigned_employee)
                check("RBAC: assigned user allowed access (negative control)", got.id, loan_rbac.id)
            except HTTPException:
                check("RBAC: assigned user allowed access (negative control)", False, True)

    # ======================================================================
    section("CODE-REVIEW FOLLOW-UPS — auto-withdraw on reclassify, cap rounding, idempotent alerts")
    # ======================================================================
    # CR8: auto bad-debt proposal must be withdrawn when reclassify removes the cap.
    # Scenario: admin realises the cap classification was wrong (e.g. wrong date
    # entered) and reclassifies the same cycle to a non-cap LATE_PAYMENT.
    loan_cr8, cycles_cr8, _ = fresh_loan()
    c1_cr8 = cycles_cr8[0]
    classify_cycle(c1_cr8.id, CycleClassifyRequest(
        cycle_status=CycleStatus.LATE_PAYMENT,
        classified_as_of_date=c1_cr8.due_date + timedelta(days=100),  # CAP
    ), db=DB, current_user=user)
    DB.refresh(loan_cr8)
    open_prop = DB.query(BadDebtProposal).filter(
        BadDebtProposal.loan_id == loan_cr8.id,
        BadDebtProposal.status == BadDebtProposalStatus.PROPOSED,
    ).first()
    check("Cap hit → auto bad-debt proposal opened", open_prop is not None and open_prop.auto_proposed, True)
    check("Loan status BAD_DEBT_PROPOSED", loan_cr8.status, LoanStatus.BAD_DEBT_PROPOSED)

    # Reclassify the cycle to 10 days late (no cap)
    reclassify_cycle_route(c1_cr8.id, CycleClassifyRequest(
        cycle_status=CycleStatus.LATE_PAYMENT,
        classified_as_of_date=c1_cr8.due_date + timedelta(days=10),
        classification_note="Original 100-day classification was incorrect.",
    ), db=DB, current_user=user)
    DB.refresh(open_prop); DB.refresh(loan_cr8); DB.refresh(c1_cr8)
    print(f"  After reclassify (cap → 10-days-late): cycle={c1_cr8.cycle_status.value}  penalty={c1_cr8.penalty_amount}  proposal={open_prop.status.value}  loan={loan_cr8.status.value}")
    check("Cycle status now LATE_PAYMENT (not capped)", c1_cr8.cycle_status, CycleStatus.LATE_PAYMENT)
    check("Penalty recomputed (5000 × 36% × 10/30 = 600)", c1_cr8.penalty_amount, Decimal("600.00"))
    check("Auto bad-debt proposal auto-withdrawn", open_prop.status, BadDebtProposalStatus.REJECTED)
    check("Loan reverted to ACTIVE", loan_cr8.status, LoanStatus.ACTIVE)
    check("Withdrawal note recorded", "Auto-withdrawn" in (open_prop.review_notes or ""), True)

    # CR7: pre-check active closure surfaces clean error (not 500)
    loan_cr7, _, _ = fresh_loan()
    # First close it normally
    close_loan_with_closure(DB, loan=loan_cr7, data=LoanCloseRequest(
        closure_type=ClosureType.NEGOTIATED_SETTLEMENT,
        final_settlement_amount=Decimal('30000'),
        amount_written_off=Decimal('30000'),
    ), closed_by=user.id)
    DB.commit()
    # Try to close again
    try:
        close_loan_with_closure(DB, loan=loan_cr7, data=LoanCloseRequest(
            closure_type=ClosureType.WRITE_OFF,
            final_settlement_amount=Decimal('0'),
            amount_written_off=Decimal('0'),
        ), closed_by=user.id)
        check("Double-close pre-check fires", False, True)
    except ValueError as e:
        DB.rollback()
        # First message — could be "Loan cannot be closed from status CLOSED" if status guard catches first
        check("Double-close pre-check fires", "Loan cannot be closed" in str(e) or "active closure already" in str(e), True)

    # CR6: DuplicateProposalError preserves caller's work (savepoint scope)
    from app.services.bad_debt import DuplicateProposalError
    loan_cr6, _, _ = fresh_loan()
    p1 = propose_bad_debt(DB, loan_cr6, proposed_by=user.id, reason="First proposal for savepoint test.")
    DB.commit()
    # Try to propose a SECOND time on the same loan
    try:
        propose_bad_debt(DB, loan_cr6, proposed_by=user.id, reason="Duplicate attempt.")
        check("DuplicateProposalError raised on second propose", False, True)
    except DuplicateProposalError:
        check("DuplicateProposalError raised on second propose", True, True)
    DB.rollback()
    # Loan should still be BAD_DEBT_PROPOSED (first proposal still effective)
    DB.refresh(loan_cr6)
    check("Loan status preserved after duplicate-proposal attempt", loan_cr6.status, LoanStatus.BAD_DEBT_PROPOSED)

    # CR2: cap-day rounding uses ceiling
    from app.jobs.nightly_cycle_check import _cap_days_for
    cap_30 = _cap_days_for(date(2026, 6, 15), Decimal('36'))  # June: 30 / 0.36 = 83.33
    cap_31 = _cap_days_for(date(2026, 7, 15), Decimal('36'))  # July: 31 / 0.36 = 86.11
    cap_28 = _cap_days_for(date(2027, 2, 15), Decimal('36'))  # Feb 2027: 28 / 0.36 = 77.77
    print(f"  cap_days: June={cap_30}  July={cap_31}  Feb={cap_28}")
    check("Cap days June ceiling (84 not 83)", cap_30, 84)
    check("Cap days July ceiling (87 not 86)", cap_31, 87)
    check("Cap days Feb ceiling (78 not 77)", cap_28, 78)

    # ======================================================================
    section("FINAL SUMMARY")
    # ======================================================================
    print(f"\n  PASS: {PASS}    FAIL: {FAIL}    TOTAL: {PASS + FAIL}")
    print()
    if FAIL > 0:
        print("  ✗ FAILED CHECKS:")
        for ok, lbl in RESULTS:
            if not ok:
                print(f"    - {lbl}")
    else:
        print("  ALL CHECKS PASSED ✓")

finally:
    cleanup()
    DB.close()
    print("\n  (Test data cleaned up.)")
