"""
Reduce frame data in alphabet JSON files using even sampling.

Input folder:
	data/alphabets/*.json

Behavior:
	- Supports files shaped as list[frame]
	- Supports files shaped as {"frames": list[frame]}
	- If frame count > TARGET_FPS, evenly samples to TARGET_FPS frames
	- Leaves shorter/equal files unchanged
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


TARGET_FPS = 12
VERBOSE_FILE_LOGS = False


@dataclass
class Stats:
	files_processed: int = 0
	files_updated: int = 0
	files_skipped: int = 0
	total_original_frames: int = 0
	total_new_frames: int = 0

	@property
	def total_frames_reduced(self) -> int:
		return self.total_original_frames - self.total_new_frames


def even_sample_frames(frames: list[Any], target_frame_count: int) -> list[Any]:
	"""Evenly sample frames while preserving order."""
	total_frames = len(frames)
	if total_frames <= target_frame_count:
		return frames

	step = total_frames / target_frame_count
	sampled: list[Any] = []

	for i in range(target_frame_count):
		idx = round(i * step)
		if idx < 0:
			idx = 0
		elif idx >= total_frames:
			idx = total_frames - 1
		sampled.append(frames[idx])

	return sampled


def downsample_payload(payload: Any, target_frame_count: int) -> tuple[Any, int, int, bool]:
	"""Downsample supported payload shapes and return (new_payload, original, new, changed)."""
	if isinstance(payload, list):
		original_count = len(payload)
		new_frames = even_sample_frames(payload, target_frame_count)
		changed = len(new_frames) != original_count
		return new_frames, original_count, len(new_frames), changed

	if isinstance(payload, dict) and isinstance(payload.get("frames"), list):
		original_frames = payload["frames"]
		original_count = len(original_frames)
		new_frames = even_sample_frames(original_frames, target_frame_count)
		changed = len(new_frames) != original_count

		if changed:
			new_payload = dict(payload)
			new_payload["frames"] = new_frames
			return new_payload, original_count, len(new_frames), True

		return payload, original_count, original_count, False

	return payload, 0, 0, False


def process_file(file_path: Path, target_frame_count: int) -> tuple[bool, int, int]:
	"""Process one JSON file, writing updated content in place when changed."""
	with file_path.open("r", encoding="utf-8") as file:
		payload = json.load(file)

	new_payload, original_count, new_count, changed = downsample_payload(payload, target_frame_count)

	if changed:
		with file_path.open("w", encoding="utf-8") as file:
			json.dump(new_payload, file, ensure_ascii=False, indent=2)
			file.write("\n")

	return changed, original_count, new_count


def reduce_alphabet_files() -> None:
	started_at = time.time()
	stats = Stats()
	alphabets_dir = Path(__file__).resolve().parent / "data" / "alphabets"

	if not alphabets_dir.exists():
		raise FileNotFoundError(f"Alphabet directory not found: {alphabets_dir}")

	files = sorted(alphabets_dir.glob("*.json"))
	if not files:
		print(f"No JSON files found in {alphabets_dir}")
		return

	for file_path in files:
		stats.files_processed += 1
		changed, original_count, new_count = process_file(file_path, TARGET_FPS)
		stats.total_original_frames += original_count
		stats.total_new_frames += new_count

		if changed:
			stats.files_updated += 1
		else:
			stats.files_skipped += 1

		if VERBOSE_FILE_LOGS:
			saved = max(0, original_count - new_count)
			print(
				f"[{file_path.name}] frames: {original_count} -> {new_count} "
				f"(saved {saved})"
			)

	elapsed = time.time() - started_at
	ratio_saved = (
		(stats.total_frames_reduced / stats.total_original_frames) * 100
		if stats.total_original_frames > 0
		else 0.0
	)

	print("\n=== Alphabet Reduction Summary ===")
	print(f"Target FPS/Frame Count: {TARGET_FPS}")
	print(f"Files processed: {stats.files_processed}")
	print(f"Files updated: {stats.files_updated}")
	print(f"Files skipped: {stats.files_skipped}")
	print(f"Total original frames: {stats.total_original_frames}")
	print(f"Total new frames: {stats.total_new_frames}")
	print(f"Total frames reduced: {stats.total_frames_reduced}")
	print(f"Overall reduction ratio: {ratio_saved:.2f}%")
	print(f"Elapsed time: {elapsed:.2f}s")


if __name__ == "__main__":
	try:
		reduce_alphabet_files()
	except KeyboardInterrupt:
		print("\nInterrupted by user.")
	except Exception as exc:
		print(f"\nError: {exc}")
		raise
