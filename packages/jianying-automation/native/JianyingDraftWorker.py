"""Write ordered video clips into a copied Jianying draft.

This executable is intentionally isolated from Electron.  Jianying's draft
codec loads the installed videoeditor.dll, so a codec crash cannot take down
the desktop application's main process.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

import pyJianYingDraft as draft


def _read_input(path: Path) -> tuple[list[str], int | None]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    values = payload.get("segments") if isinstance(payload, dict) else None
    if not isinstance(values, list) or not values:
        raise ValueError("分段列表为空")

    segments: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("分段路径格式无效")
        resolved = str(Path(value).resolve())
        if not Path(resolved).is_file():
            raise FileNotFoundError(f"分段视频不存在：{Path(resolved).name}")
        segments.append(resolved)
    preferred = payload.get("preferredTimelineTime")
    if preferred is not None and (not isinstance(preferred, (int, float)) or preferred < 0):
        raise ValueError("推荐预览时间格式无效")
    return segments, round(preferred) if preferred is not None else None


def _subtitle_free_time(
    script: Any,
    duration: int,
    preferred: int | None,
) -> tuple[int | None, int, int, list[tuple[int, int]]]:
    subtitle_tracks = [
        track for track in script.imported_tracks
        if track.track_type == draft.TrackType.text and len(getattr(track, "segments", [])) > 1
    ]
    if not subtitle_tracks:
        return min(preferred or 350_000, max(0, duration - 1)), 0, 1, [(0, duration)]

    # In Jianying's top-to-bottom overlay stack this is the fourth visible
    # track. Prefer its semantic name, then fall back to the multi-segment text
    # track for presets created by older Jianying versions.
    subtitle_track = next(
        (track for track in subtitle_tracks if "字幕" in getattr(track, "name", "")),
        max(subtitle_tracks, key=lambda track: len(track.segments)),
    )
    ranges = sorted(
        (segment.target_timerange.start, segment.target_timerange.end)
        for segment in subtitle_track.segments
    )
    merged: list[list[int]] = []
    for start, end in ranges:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    gaps: list[tuple[int, int]] = []
    cursor = 0
    for start, end in merged:
        if start > cursor:
            gaps.append((cursor, min(start, duration)))
        cursor = max(cursor, end)
    if cursor < duration:
        gaps.append((cursor, duration))

    margin = 150_000
    usable = [(start + margin, end - margin) for start, end in gaps if end - start >= margin * 2]
    if not usable:
        return None, len(ranges), len(gaps), []
    target = preferred if preferred is not None else usable[0][0]
    selected_range = min(
        usable,
        key=lambda value: abs(min(max(target, value[0]), value[1]) - target),
    )
    selected = min(max(target, selected_range[0]), selected_range[1])
    return selected, len(ranges), len(gaps), usable


def _remove_existing_video_content(script: Any) -> None:
    removed_ids: set[str] = set()
    retained_tracks = []
    for track in script.imported_tracks:
        if track.track_type != draft.TrackType.video:
            retained_tracks.append(track)
            continue
        for segment in getattr(track, "segments", []):
            material_id = getattr(segment, "material_id", "")
            if material_id:
                removed_ids.add(material_id)
            raw_data = getattr(segment, "raw_data", {})
            if isinstance(raw_data, dict):
                removed_ids.update(
                    value for value in raw_data.get("extra_material_refs", [])
                    if isinstance(value, str)
                )
    script.imported_tracks = retained_tracks

    for material in script.imported_materials.get("videos", []):
        if isinstance(material, dict) and isinstance(material.get("id"), str):
            removed_ids.add(material["id"])
    script.imported_materials["videos"] = []

    for material_type, materials in list(script.imported_materials.items()):
        if not isinstance(materials, list):
            continue
        script.imported_materials[material_type] = [
            material for material in materials
            if not (
                isinstance(material, dict)
                and isinstance(material.get("id"), str)
                and material["id"] in removed_ids
            )
        ]


def _main_timeline_id(draft_path: Path) -> str | None:
    project_path = draft_path / "Timelines" / "project.json"
    if not project_path.is_file():
        return None
    project = json.loads(project_path.read_text(encoding="utf-8-sig"))
    for key in ("main_timeline_id", "mainTimelineId", "timeline_id", "timelineId"):
        value = project.get(key) if isinstance(project, dict) else None
        if isinstance(value, str) and value:
            return value
    return None


def _atomic_copy(source: Path, target: Path) -> None:
    if not target.is_file():
        return
    backup = target.with_name(f"{target.name}.autodrama.bak")
    if not backup.exists():
        shutil.copy2(target, backup)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _sync_mirrors(draft_path: Path, source: Path) -> list[str]:
    targets = [draft_path / "template-2.tmp"]
    timeline_id = _main_timeline_id(draft_path)
    if timeline_id:
        timeline = draft_path / "Timelines" / timeline_id
        targets.extend([timeline / "draft_content.json", timeline / "template-2.tmp"])
    updated: list[str] = []
    for target in targets:
        if target.resolve() == source.resolve() or not target.is_file():
            continue
        _atomic_copy(source, target)
        updated.append(str(target))
    return updated


def write_track(draft_path: Path, install_dir: Path, input_path: Path) -> dict[str, Any]:
    draft_path = draft_path.resolve()
    install_dir = install_dir.resolve()
    if not draft_path.is_dir():
        raise FileNotFoundError("剪映草稿目录不存在")
    if not (install_dir / "videoeditor.dll").is_file():
        raise FileNotFoundError("剪映安装目录中缺少 videoeditor.dll")

    segments, preferred_time = _read_input(input_path.resolve())
    codec = draft.JianyingDraftCryptoCodec(
        draft.DraftCryptoConfig(
            jy_install_dir=str(install_dir),
            # The worker process itself is the crash boundary. A second Python
            # subprocess cannot reliably re-enter a PyInstaller one-file app.
            isolated=False,
            validate_roundtrip=True,
        )
    )
    folder = draft.DraftFolder(str(draft_path.parent), content_codec=codec)
    script = folder.load_template(draft_path.name)
    materials = [draft.VideoMaterial(segment) for segment in segments]
    subtitle_free_time, subtitle_count, subtitle_gap_count, subtitle_free_ranges = _subtitle_free_time(
        script,
        sum(material.duration for material in materials),
        preferred_time,
    )
    _remove_existing_video_content(script)

    track = script.insert_track(
        draft.TrackSpec(draft.TrackType.video, "自动视频轨道", mute=True),
        at_index=0,
    )
    cursor = 0
    durations: list[int] = []
    for material in materials:
        duration = material.duration
        script.add_segment(
            draft.VideoSegment(
                material,
                draft.Timerange(cursor, duration),
                source_timerange=draft.Timerange(0, duration),
                volume=0.0,
            ),
            track,
        )
        durations.append(duration)
        cursor += duration

    content_path = draft_path / "draft_content.json"
    script.duration = max(script.duration, cursor)
    script.dump(str(content_path))
    mirrors = _sync_mirrors(draft_path, content_path)

    source_hash = hashlib.sha256(content_path.read_bytes()).hexdigest()
    for mirror in mirrors:
        if hashlib.sha256(Path(mirror).read_bytes()).hexdigest() != source_hash:
            raise RuntimeError(f"草稿镜像校验失败：{Path(mirror).name}")

    # A final decode catches both encryption and persistence problems before
    # Jianying is ever started with the generated draft.
    verified = codec.decode(content_path.read_bytes())
    video_tracks = [track for track in verified.get("tracks", []) if track.get("type") == "video"]
    verified_segments = sum(len(track.get("segments", [])) for track in video_tracks)
    if verified_segments != len(segments):
        raise RuntimeError("草稿回读后的视频片段数量不一致")

    return {
        "success": True,
        "videoCount": len(segments),
        "duration": cursor,
        "segmentDurations": durations,
        "subtitleFreeTimelineTime": subtitle_free_time,
        "subtitleTrackSegmentCount": subtitle_count,
        "subtitleGapCount": subtitle_gap_count,
        "subtitleFreeRanges": subtitle_free_ranges,
        "sha256": source_hash,
        "updatedFiles": [str(content_path), *mirrors],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    write_parser = subparsers.add_parser("write-track")
    write_parser.add_argument("--draft", required=True)
    write_parser.add_argument("--install-dir", required=True)
    write_parser.add_argument("--input", required=True)
    args = parser.parse_args()

    try:
        result = write_track(Path(args.draft), Path(args.install_dir), Path(args.input))
        # Keep stdout ASCII-only so Electron receives stable JSON regardless of
        # the Windows console code page used by the packaged worker.
        print(json.dumps(result, ensure_ascii=True, separators=(",", ":")), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"success": False, "message": str(error)}, ensure_ascii=True), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
