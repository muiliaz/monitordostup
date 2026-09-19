-- Hourly rollup of check_results, kept up to date in the same transaction
-- that inserts a result (monitor/applyResult.ts). Week/month charts and 24 h
-- uptime read this table instead of scanning raw results.
CREATE TABLE "check_results_hourly" (
    "check_id" INTEGER NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    -- Response time of successful results only: a timeout says nothing about speed.
    "sum_ms_ok" BIGINT NOT NULL,
    "max_ms_ok" INTEGER,

    CONSTRAINT "check_results_hourly_pkey" PRIMARY KEY ("check_id", "hour")
);

ALTER TABLE "check_results_hourly" ADD CONSTRAINT "check_results_hourly_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the history recorded so far.
INSERT INTO "check_results_hourly" ("check_id", "hour", "total", "failures", "sum_ms_ok", "max_ms_ok")
SELECT check_id,
       date_trunc('hour', checked_at, 'UTC'),
       count(*),
       count(*) FILTER (WHERE NOT is_success),
       coalesce(sum(response_time_ms) FILTER (WHERE is_success), 0),
       max(response_time_ms) FILTER (WHERE is_success)
FROM "check_results"
GROUP BY 1, 2;
