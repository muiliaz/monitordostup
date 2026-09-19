-- Stage 10 measurement: raw check_results vs the hourly rollup for chart queries.
-- Works in a separate schema `bench`, the application tables are not touched.
--
--   docker compose exec -T postgres psql -U monitor -d monitor < scripts/bench/history-rollup.sql
--
-- For cold-cache numbers restart postgres and drop the VM page cache first:
--   docker compose restart postgres
--   docker run --rm --privileged postgres:16-alpine sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'
-- and run only the EXPLAIN part (below the "measure" marker).

\timing on
DROP SCHEMA IF EXISTS bench CASCADE;
CREATE SCHEMA bench;
CREATE TABLE bench.check_results (LIKE public.check_results INCLUDING DEFAULTS);
ALTER TABLE bench.check_results ALTER COLUMN id DROP DEFAULT;
CREATE SEQUENCE bench.seq;
ALTER TABLE bench.check_results ALTER COLUMN id SET DEFAULT nextval('bench.seq');

-- 50 checks x 30 days x every 30 s = 4.32M rows. Time outer, checks inner:
-- rows of one check are spread over the heap as they would be in production.
INSERT INTO bench.check_results (check_id, checked_at, is_success, response_time_ms, http_code)
SELECT c, t + (c * interval '0.5 second'),
       NOT (random() < 0.01 OR (c % 10 = 0 AND t BETWEEN now() - interval '10 days' AND now() - interval '10 days' + interval '2 hours')),
       (40 + random() * 250)::int, 200
FROM generate_series(now() - interval '30 days', now(), interval '30 seconds') t,
     generate_series(1, 50) c
ORDER BY t, c;
CREATE INDEX ON bench.check_results (check_id, checked_at);
ALTER TABLE bench.check_results ADD PRIMARY KEY (id);

CREATE TABLE bench.hourly AS
SELECT check_id, date_trunc('hour', checked_at, 'UTC') AS hour,
       count(*)::int AS total, (count(*) FILTER (WHERE NOT is_success))::int AS failures,
       coalesce(sum(response_time_ms) FILTER (WHERE is_success), 0)::bigint AS sum_ms_ok,
       max(response_time_ms) FILTER (WHERE is_success) AS max_ms_ok
FROM bench.check_results GROUP BY 1, 2;
ALTER TABLE bench.hourly ADD PRIMARY KEY (check_id, hour);
VACUUM ANALYZE bench.check_results;
VACUUM ANALYZE bench.hourly;
SELECT pg_size_pretty(pg_total_relation_size('bench.check_results')) AS raw_size,
       pg_size_pretty(pg_total_relation_size('bench.hourly')) AS rollup_size;

-- measure ---------------------------------------------------------------
-- month, 6 h buckets, raw
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT date_bin('6 hours', checked_at, '2000-01-01'), count(*), count(*) FILTER (WHERE NOT is_success),
       avg(response_time_ms) FILTER (WHERE is_success), max(response_time_ms)
FROM bench.check_results WHERE check_id = 17 AND checked_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1;
-- month, 6 h buckets, rollup
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT date_bin('6 hours', hour, '2000-01-01'), sum(total), sum(failures),
       sum(sum_ms_ok)::float / nullif(sum(total - failures), 0), max(max_ms_ok)
FROM bench.hourly WHERE check_id = 17 AND hour >= now() - interval '30 days' GROUP BY 1 ORDER BY 1;
-- day, 15 min buckets, raw (what the "day" chart uses)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
SELECT date_bin('15 minutes', checked_at, '2000-01-01'), count(*), count(*) FILTER (WHERE NOT is_success),
       avg(response_time_ms) FILTER (WHERE is_success), max(response_time_ms)
FROM bench.check_results WHERE check_id = 31 AND checked_at >= now() - interval '1 day' GROUP BY 1 ORDER BY 1;

-- Clean up with: DROP SCHEMA bench CASCADE;
