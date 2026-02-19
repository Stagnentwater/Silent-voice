"""
Reduce animation frame data stored in `signs.poses` (JSONB) using even sampling.

Expected table shape:
	signs(
	  id,
	  word,
	  poses JSONB,
	  embedding vector(384)
	)

How it works:
1) Connects to PostgreSQL using standard connection parameters (env vars).
2) Reads rows from `signs` in ID-ordered batches.
3) Downsamples frames in `poses` to a configurable TARGET_FPS count (even sampling).
4) Writes back reduced JSONB and commits in batches.
5) Prints progress and an end summary.

Environment variables (optional):
	PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
"""

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import Json


# Sampling target (configurable).
TARGET_FPS = 12

# Number of rows fetched per SELECT page.
FETCH_BATCH_SIZE = 200

# Commit transaction after this many processed rows.
COMMIT_EVERY = 200

# If True, prints per-row frame reduction details.
VERBOSE_ROW_LOGS = False


# Load .env from the current working directory and this script's directory.
# Existing environment variables are preserved (not overridden).
load_dotenv()
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")


@dataclass
class Stats:
	total_rows_processed: int = 0
	total_rows_updated: int = 0
	total_rows_skipped: int = 0
	total_original_frames: int = 0
	total_new_frames: int = 0

	@property
	def total_frames_reduced(self) -> int:
		return self.total_original_frames - self.total_new_frames


def env(name: str, default: str) -> str:
	"""Read environment variable with fallback, stripping surrounding whitespace."""
	value = os.getenv(name)
	if value is None:
		return default
	return value.strip()


def first_env(names: List[str], default: str) -> str:
	"""Return the first non-empty env var from names, else default."""
	for name in names:
		value = os.getenv(name)
		if value is not None and value.strip() != "":
			return value.strip()
	return default


def get_connection():
	"""
	Create a PostgreSQL connection from env vars.

	Supported variable names:
	  - host: PGHOST or DB_HOST
	  - port: PGPORT or DB_PORT
	  - db:   PGDATABASE or DB_NAME
	  - user: PGUSER or DB_USER
	  - pass: PGPASSWORD, POSTGRES_PASSWORD, or DB_PASSWORD
	  - ssl:  PGSSLMODE or DB_SSLMODE (optional)
	"""
	host = first_env(["PGHOST", "DB_HOST"], "localhost")
	port = int(first_env(["PGPORT", "DB_PORT"], "5432"))
	dbname = first_env(["PGDATABASE", "DB_NAME"], "postgres")
	user = first_env(["PGUSER", "DB_USER"], "postgres")
	password = first_env(["PGPASSWORD", "POSTGRES_PASSWORD", "DB_PASSWORD"], "postgres")
	sslmode = first_env(["PGSSLMODE", "DB_SSLMODE"], "")

	connect_kwargs = {
		"host": host,
		"port": port,
		"dbname": dbname,
		"user": user,
		"password": password,
	}

	if sslmode:
		connect_kwargs["sslmode"] = sslmode

	return psycopg2.connect(**connect_kwargs)


def even_sample_frames(frames: List[Any], target_frame_count: int) -> List[Any]:
	"""
	Evenly sample a list of frames while preserving order.

	Formula requested:
		step = total_frames / target_frame_count
		selected_frames = original_frames[round(i * step)]

	Note: indices are clamped to valid range to avoid out-of-bounds.
	"""
	total_frames = len(frames)
	if total_frames <= target_frame_count:
		return frames

	step = total_frames / target_frame_count
	sampled: List[Any] = []

	for i in range(target_frame_count):
		idx = round(i * step)
		if idx < 0:
			idx = 0
		elif idx >= total_frames:
			idx = total_frames - 1
		sampled.append(frames[idx])

	return sampled


def downsample_poses(poses: Any, target_frame_count: int) -> Tuple[Any, int, int, bool]:
	"""
	Downsample frames in `poses` JSON structure.

	Supports:
	  1) poses as list[frame]
	  2) poses as dict with key `frames` that is list[frame]

	Returns:
	  (new_poses, original_count, new_count, changed)
	"""
	if poses is None:
		return poses, 0, 0, False

	if isinstance(poses, list):
		original_count = len(poses)
		new_frames = even_sample_frames(poses, target_frame_count)
		changed = len(new_frames) != original_count
		return new_frames, original_count, len(new_frames), changed

	if isinstance(poses, dict) and isinstance(poses.get("frames"), list):
		original_frames = poses["frames"]
		original_count = len(original_frames)
		new_frames = even_sample_frames(original_frames, target_frame_count)
		changed = len(new_frames) != original_count

		if changed:
			# Make a shallow copy so we don't mutate in-place unexpectedly.
			new_poses = dict(poses)
			new_poses["frames"] = new_frames
			return new_poses, original_count, len(new_frames), True

		return poses, original_count, original_count, False

	# Unknown shape: skip safely.
	return poses, 0, 0, False


def fetch_batch(cur, last_id: int, batch_size: int) -> List[Tuple[int, Optional[str], Any]]:
	"""Fetch a page of rows ordered by id for stable batch processing."""
	cur.execute(
		"""
		SELECT id, word, poses
		FROM signs
		WHERE id > %s
		ORDER BY id
		LIMIT %s
		""",
		(last_id, batch_size),
	)
	return cur.fetchall()


def process_signs() -> None:
	"""Main processing loop."""
	started_at = time.time()
	stats = Stats()
	last_id = 0
	rows_since_commit = 0

	with get_connection() as conn:
		conn.autocommit = False

		with conn.cursor() as read_cur, conn.cursor() as write_cur:
			while True:
				rows = fetch_batch(read_cur, last_id, FETCH_BATCH_SIZE)
				if not rows:
					break

				for row_id, word, poses in rows:
					stats.total_rows_processed += 1
					last_id = row_id

					new_poses, original_count, new_count, changed = downsample_poses(
						poses, TARGET_FPS
					)

					stats.total_original_frames += original_count
					stats.total_new_frames += new_count

					if changed:
						write_cur.execute(
							"UPDATE signs SET poses = %s WHERE id = %s",
							(Json(new_poses), row_id),
						)
						stats.total_rows_updated += 1
					else:
						stats.total_rows_skipped += 1

					if VERBOSE_ROW_LOGS:
						saved = max(0, original_count - new_count)
						ratio = (saved / original_count * 100) if original_count > 0 else 0.0
						print(
							f"[row id={row_id} word={word!r}] "
							f"frames: {original_count} -> {new_count} "
							f"(saved {saved}, {ratio:.1f}%)"
						)

					rows_since_commit += 1
					if rows_since_commit >= COMMIT_EVERY:
						conn.commit()
						print(
							f"Committed batch: processed={stats.total_rows_processed}, "
							f"updated={stats.total_rows_updated}, "
							f"frames_reduced={stats.total_frames_reduced}"
						)
						rows_since_commit = 0

			# Final commit for remaining rows.
			conn.commit()

	elapsed = time.time() - started_at
	ratio_saved = (
		(stats.total_frames_reduced / stats.total_original_frames) * 100
		if stats.total_original_frames > 0
		else 0.0
	)

	print("\n=== Reduction Summary ===")
	print(f"Target FPS/Frame Count: {TARGET_FPS}")
	print(f"Total rows processed: {stats.total_rows_processed}")
	print(f"Rows updated: {stats.total_rows_updated}")
	print(f"Rows skipped: {stats.total_rows_skipped}")
	print(f"Total original frames: {stats.total_original_frames}")
	print(f"Total new frames: {stats.total_new_frames}")
	print(f"Total frames reduced: {stats.total_frames_reduced}")
	print(f"Overall reduction ratio: {ratio_saved:.2f}%")
	print(f"Elapsed time: {elapsed:.2f}s")


if __name__ == "__main__":
	try:
		process_signs()
	except KeyboardInterrupt:
		print("\nInterrupted by user. Any committed batches are preserved.")
	except Exception as exc:
		print(f"\nError: {exc}")
		raise
