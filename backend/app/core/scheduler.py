"""
In-process scheduler for the nightly cycle check.

Why APScheduler in-process instead of cron / k8s CronJob
--------------------------------------------------------
The MVP runs as a single FastAPI app talking to a single Postgres.
Adding an external scheduler (cron file, k8s CronJob, Celery beat) is
real infrastructure with its own auth + deploy story. APScheduler in
the app process gets us a working nightly run today; the moment we
deploy multiple workers or move to k8s we can swap to a CronJob
without touching the job code itself (`app/jobs/nightly_cycle_check.py`
already exposes `run_once()` and works as a CLI entrypoint).

Safety
------
- Multi-worker uvicorn would otherwise fire `run_once()` N times. We
  grab a transaction-scoped Postgres advisory lock keyed on
  `settings.NIGHTLY_JOB_LOCK_KEY` BEFORE doing any work. If another
  worker already holds it, we silently no-op and log. The lock is held
  for the lifetime of the run and auto-released on connection close.
- The job uses its own short-lived session (not a request session) so
  it doesn't share state with HTTP traffic.
- Errors are caught and logged here so APScheduler's internal job
  state stays clean — a single failed run never disables future fires.

Disabling
---------
- Tests / CI: set `NIGHTLY_JOB_ENABLED=false` in env.
- Switching to external scheduling later: leave `_ENABLED=false` and
  run `python -m app.jobs.nightly_cycle_check` from cron / k8s.
"""
from __future__ import annotations

import logging
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from app.core.config import settings
from app.core.db import SessionLocal

logger = logging.getLogger("scheduler")

# Module-level handle so main.py can stop the scheduler at shutdown.
_scheduler: BackgroundScheduler | None = None


def _run_nightly_with_lock() -> None:
    """Acquire the advisory lock, run nightly job, release on close."""
    # Imported lazily so the scheduler module itself is cheap to import
    # (tests that don't fire the job avoid pulling penalty/loan trees).
    from app.jobs.nightly_cycle_check import run_once

    session = SessionLocal()
    try:
        # pg_try_advisory_lock returns True if we got it, False otherwise.
        # Session-scoped (not transaction-scoped) so it survives the
        # per-loan commits inside run_once.
        got_lock = session.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": settings.NIGHTLY_JOB_LOCK_KEY},
        ).scalar()

        if not got_lock:
            logger.info(
                "nightly job lock=%s already held — another worker is running; skipping",
                settings.NIGHTLY_JOB_LOCK_KEY,
            )
            return

        try:
            summary = run_once(db=session)
            logger.info("nightly job summary: %s", summary)
        finally:
            session.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": settings.NIGHTLY_JOB_LOCK_KEY},
            )
            session.commit()
    except Exception:
        # Swallow — APScheduler will fire again tomorrow. We log full
        # traceback so an operator can diagnose, but never re-raise into
        # the scheduler's own bookkeeping.
        logger.exception("nightly job execution failed")
    finally:
        session.close()


def start_scheduler() -> None:
    """Start the background scheduler. Called once from FastAPI startup."""
    global _scheduler
    if not settings.NIGHTLY_JOB_ENABLED:
        logger.info("NIGHTLY_JOB_ENABLED=false — scheduler not started")
        return

    if _scheduler is not None:
        logger.warning("start_scheduler called twice — ignoring")
        return

    _scheduler = BackgroundScheduler(timezone=settings.REPORTS_TIMEZONE)
    _scheduler.add_job(
        _run_nightly_with_lock,
        trigger=CronTrigger(
            hour=settings.NIGHTLY_JOB_HOUR,
            minute=settings.NIGHTLY_JOB_MINUTE,
            # BackgroundScheduler's timezone= is NOT inherited by a CronTrigger
            # constructed explicitly — APScheduler 3.x falls back to the system
            # zone (UTC on the EC2 host). Pin it on the trigger itself.
            timezone=ZoneInfo(settings.REPORTS_TIMEZONE),
        ),
        id="nightly_cycle_check",
        # `coalesce=True`: if the app was offline at fire time, run ONCE on
        # next start (not N times for every missed window).
        coalesce=True,
        # `max_instances=1`: a misconfigured short cron would otherwise
        # let two runs overlap inside one process.
        max_instances=1,
        # 15-minute grace so a slow startup doesn't drop the day's run.
        misfire_grace_time=15 * 60,
    )
    _scheduler.start()
    logger.info(
        "scheduler started: nightly_cycle_check @ %02d:%02d %s",
        settings.NIGHTLY_JOB_HOUR,
        settings.NIGHTLY_JOB_MINUTE,
        settings.REPORTS_TIMEZONE,
    )


def stop_scheduler() -> None:
    """Stop the background scheduler. Called once from FastAPI shutdown."""
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    logger.info("scheduler stopped")
