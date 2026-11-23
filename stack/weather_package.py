
"""Build versioned deployment ZIPs for Weather Advisor.

Packages production application files only.
Does not contact AWS or modify EC2 resources.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT_DIR = PROJECT_ROOT / "deployment_artifacts"

PRODUCTION_FILES = {
    "weather": [
        "app.js",
        "aggregation.js",
        "dynamo_cache.js",
        "period_selector.js",
        "precipitation.js",
        "report_builder.js",
        "validation.js",
        "weather_clients.js",
        "package.json",
        "package-lock.json",
    ],
    "advisor": [
        "app.js",
        "advice_cache.js",
        "advice_service.js",
        "email_rate_limit.js",
        "gemini_quota.js",
        "gemini_report.js",
        "sns_email.js",
        "views/form.js",
        "package.json",
        "package-lock.json",
    ],
}


def build_package(service: str) -> Path:
    """Create a production ZIP with a content-based version."""

    if service not in PRODUCTION_FILES:
        raise ValueError(f"Unknown application: {service}")

    app_dir = PROJECT_ROOT / f"{service}-app"
    names = sorted(PRODUCTION_FILES[service])

    missing = [
        name
        for name in names
        if not (app_dir / name).is_file()
    ]

    if missing:
        raise FileNotFoundError(
            f"{service} is missing: {', '.join(missing)}"
        )

    # Derive the version from filenames and file contents.
    digest = hashlib.sha256()

    for name in names:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update((app_dir / name).read_bytes())
        digest.update(b"\0")

    version = digest.hexdigest()[:16]

    ARTIFACT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    zip_path = (
        ARTIFACT_DIR /
        f"weather-advisor-{service}-{version}.zip"
    )

    with ZipFile(
        zip_path,
        "w",
        compression=ZIP_DEFLATED,
    ) as archive:
        for name in names:
            source = app_dir / name
            archive.write(
                filename=source,
                arcname=name,
            )

    with ZipFile(zip_path, "r") as archive:
        bad_file = archive.testzip()

        if bad_file is not None:
            raise RuntimeError(
                f"Invalid ZIP entry: {bad_file}"
            )

        packaged = set(archive.namelist())

        if packaged != set(names):
            raise RuntimeError(
                f"Incorrect files in {service} package"
            )

    print(
        f"PASS: {service} package created"
    )
    print(f"  File: {zip_path}")
    print(f"  Version: {version}")
    print(f"  Production files: {len(names)}")
    print(f"  ZIP size: {zip_path.stat().st_size} bytes")

    return zip_path


def build_all_packages() -> dict[str, Path]:
    """Build both application deployment packages."""
    return {
        service: build_package(service)
        for service in ("weather", "advisor")
    }


if __name__ == "__main__":
    build_all_packages()
