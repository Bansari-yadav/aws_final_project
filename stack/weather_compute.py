
"""EC2 provisioning for the Weather Advisor project.

Generate Python-only EC2 user-data that installs and starts
the Node.js applications from private S3 deployment artifacts.

No Bash script, shell=True, or .sh file is generated.
"""

from __future__ import annotations

import base64
from pathlib import Path

from .config import Tier
from .weather_config import WeatherSettings


ARTIFACT_BUCKET = "weather-advisor-artifacts-587104705562-us-east-2"


def find_deployment_package(settings, service: str) -> Path:
    """Find the latest locally built ZIP for a service."""

    if service not in ("weather", "advisor"):
        raise ValueError(f"Unknown service: {service}")

    artifact_dir = settings.base_dir / "deployment_artifacts"

    packages = list(
        artifact_dir.glob(f"weather-advisor-{service}-*.zip")
    )

    if not packages:
        raise FileNotFoundError(
            f"No deployment ZIP found for {service}. "
            "Build the application artifact first."
        )

    return max(
        packages,
        key=lambda path: (path.stat().st_mtime_ns, path.name),
    )


def build_environment(settings, tier, alb_dns: str) -> dict:
    """Return service settings without including secret values."""

    environment = {
        "PORT": str(settings.app_port),
        "AWS_REGION": settings.region,
        "NODE_ENV": "production",
    }

    if tier.name == "weather":
        environment.update({
            "NWS_USER_AGENT": (
                f"(itmo-444-544 Weather Advisor, "
                f"{settings.contact_email})"
            ),
            "CACHE_SECONDS": str(settings.cache_seconds),
        })

    elif tier.name == "advisor":
        if not alb_dns:
            raise ValueError(
                "Advisor startup requires the ALB DNS name."
            )

        environment.update({
            "WEATHER_URL": (
                f"http://{alb_dns}:"
                f"{settings.weather.listener_port}"
            ),
            "GEMINI_KEY_PARAM": settings.gemini_param_name,
            "GEMINI_MODEL": settings.gemini_model,
            "KEY_CACHE_SECONDS": str(
                settings.key_cache_seconds
            ),
            "GEMINI_USAGE_TABLE": settings.usage_table,
            "EMAIL_DAILY_LIMIT": str(settings.email_daily_limit),
            "SNS_TOPIC_ARN": (
                f"arn:aws:sns:{settings.region}:"
                f"587104705562:{settings.sns_topic_name}"
            ),
            "SNS_TEST_RECIPIENT": "bansari2204@gmail.com",
            "SNS_SECOND_RECIPIENT": "byadav1@hawk.illinoistech.edu",
            "SNS_SECOND_TOPIC_ARN": (
                f"arn:aws:sns:{settings.region}:"
                "587104705562:weather-advisor-recipient-b"
            ),

            "ENABLE_SNS_EMAIL": "true",
        })

    else:
        raise ValueError(f"Unknown tier: {tier.name}")

    return environment


# This is Python source code executed by cloud-init.
# External executables are invoked using argument lists,
# without a shell interpreter.
_BOOTSTRAP_PYTHON = r'''
import json
import logging
import os
import shutil
import subprocess
import sys
import traceback
import zipfile
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            "/var/log/weather-advisor-bootstrap.log"
        ),
    ],
)

log = logging.getLogger("weather-advisor-bootstrap")


def run_command(arguments, cwd=None):
    """Execute a program directly, without a shell."""

    log.info("Running: %s", arguments[0])

    subprocess.run(
        arguments,
        cwd=str(cwd) if cwd else None,
        check=True,
        shell=False,
    )


def check_program(name):
    """Require an installed executable."""

    executable = shutil.which(name)

    if executable is None:
        raise RuntimeError(
            f"Required executable is unavailable: {name}"
        )

    return executable


def extract_package(archive, destination):
    """Extract the trusted project ZIP without path traversal."""

    destination = destination.resolve()

    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            target = (destination / member.filename).resolve()

            if os.path.commonpath(
                [str(destination), str(target)]
            ) != str(destination):
                raise RuntimeError(
                    "Unsafe path inside deployment ZIP"
                )

        package.extractall(destination)


def install_dependencies():
    """Install Node.js and npm using Python subprocess calls."""

    dnf = check_program("dnf")

    run_command([
        dnf,
        "install",
        "-y",
        "nodejs",
        "npm",
    ])

    check_program("node")
    check_program("npm")
    check_program("aws")
    check_program("systemctl")


def download_application(config, archive):
    """Download the versioned ZIP using the EC2 IAM profile."""

    s3_uri = (
        f"s3://{config['bucket']}/"
        f"{config['service']}/{config['package']}"
    )

    aws_cli = check_program("aws")

    run_command([
        aws_cli,
        "s3",
        "cp",
        s3_uri,
        str(archive),
        "--region",
        config["region"],
    ])


def install_application(config):
    """Install the application and production dependencies."""

    app_dir = Path(config["application_dir"])
    app_dir.mkdir(parents=True, exist_ok=True)

    archive = Path(
        f"/tmp/weather-advisor-{config['service']}.zip"
    )

    try:
        download_application(config, archive)
        extract_package(archive, app_dir)

        for required_file in (
            "app.js",
            "package.json",
            "package-lock.json",
        ):
            if not (app_dir / required_file).is_file():
                raise RuntimeError(
                    f"Deployment artifact missing {required_file}"
                )

        run_command([
            check_program("npm"),
            "ci",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
        ], cwd=app_dir)

    finally:
        archive.unlink(missing_ok=True)

    for root, directories, files in os.walk(app_dir):
        shutil.chown(root, user="ec2-user", group="ec2-user")

        for name in directories:
            shutil.chown(
                os.path.join(root, name),
                user="ec2-user",
                group="ec2-user",
            )

        for name in files:
            file_path = os.path.join(root, name)
            if not os.path.islink(file_path):
                shutil.chown(
                    file_path,
                    user="ec2-user",
                    group="ec2-user",
                )


def create_systemd_service(config):
    """Write the Node.js systemd service definition."""

    app_dir = config["application_dir"]
    service_name = config["service_name"]
    node = check_program("node")

    environment_lines = "\n".join(
        "Environment=" + json.dumps(f"{key}={value}")
        for key, value in config["environment"].items()
    )

    unit = (
        "[Unit]\n"
        f"Description=Weather Advisor {config['service']} service\n"
        "Wants=network-online.target\n"
        "After=network-online.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"{environment_lines}\n"
        f"WorkingDirectory={app_dir}\n"
        f"ExecStart={node} {app_dir}/app.js\n"
        "Restart=always\n"
        "RestartSec=5\n"
        "User=ec2-user\n\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )

    unit_path = Path(
        f"/etc/systemd/system/{service_name}.service"
    )

    unit_path.write_text(unit, encoding="utf-8")

    systemctl = check_program("systemctl")

    run_command([systemctl, "daemon-reload"])
    run_command([
        systemctl,
        "enable",
        f"{service_name}.service",
    ])
    run_command([
        systemctl,
        "restart",
        f"{service_name}.service",
    ])


def main():
    """Provision the EC2 application using Python."""

    log.info(
        "Starting Weather Advisor %s deployment",
        CONFIG["service"],
    )

    install_dependencies()
    install_application(CONFIG)
    create_systemd_service(CONFIG)

    log.info(
        "Weather Advisor %s deployment completed",
        CONFIG["service"],
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log.error("EC2 bootstrap failed")
        log.error(traceback.format_exc())
        sys.exit(1)
'''


def build_user_data(
    settings: WeatherSettings,
    tier: Tier,
    alb_dns: str,
    db_host: str = "",
) -> str:
    """Generate Python EC2 user-data for the requested tier."""

    del db_host

    package = find_deployment_package(
        settings,
        tier.name,
    )

    environment = build_environment(
        settings,
        tier,
        alb_dns,
    )

    config = {
        "service": tier.name,
        "service_name": tier.service_name,
        "bucket": ARTIFACT_BUCKET,
        "package": package.name,
        "region": settings.region,
        "application_dir": (
            f"/opt/weather-advisor/{tier.name}"
        ),
        "environment": environment,
    }

    # Python literals preserve the configuration types.
    script = (
        "#!/usr/bin/env python3\n"
        "# Weather Advisor Python EC2 bootstrap\n"
        f"CONFIG = {config!r}\n"
        + _BOOTSTRAP_PYTHON
    )

    if len(script.encode("utf-8")) >= 16384:
        raise ValueError(
            f"{tier.name} user-data exceeds the 16 KB limit."
        )

    return script


def launch_template_data(
    settings: WeatherSettings,
    tier: Tier,
    alb_dns: str,
    db_host: str = "",
) -> dict:
    """Return the EC2 launch-template configuration."""

    user_data = build_user_data(
        settings,
        tier,
        alb_dns,
        db_host,
    )

    return {
        "ImageId": settings.ami_id,
        "InstanceType": settings.instance_type,
        "KeyName": settings.key_name,
        "SecurityGroupIds": [settings.app_sg_id],
        "IamInstanceProfile": {
            "Name": tier.profile_name
        },
        "UserData": base64.b64encode(
            user_data.encode("utf-8")
        ).decode("ascii"),
        "TagSpecifications": [
            {
                "ResourceType": "instance",
                "Tags": [
                    {
                        "Key": "Name",
                        "Value": f"{tier.name}-app",
                    }
                ],
            }
        ],
    }


def ensure_launch_template(
    aws,
    settings: WeatherSettings,
    tier: Tier,
    alb_dns: str,
    db_host: str = "",
) -> int:
    """Create a launch template or add a changed version."""

    from .compute import launch_template_exists

    data = launch_template_data(
        settings,
        tier,
        alb_dns,
        db_host,
    )

    if not launch_template_exists(aws, tier):
        result = aws.ec2.create_launch_template(
            LaunchTemplateName=tier.lt_name,
            LaunchTemplateData=data,
        )

        return result[
            "LaunchTemplate"
        ]["LatestVersionNumber"]

    latest = aws.ec2.describe_launch_template_versions(
        LaunchTemplateName=tier.lt_name,
        Versions=["$Latest"],
    )["LaunchTemplateVersions"][0]

    existing_data = latest["LaunchTemplateData"]

    if all(
        existing_data.get(key) == value
        for key, value in data.items()
    ):
        return latest["VersionNumber"]

    result = aws.ec2.create_launch_template_version(
        LaunchTemplateName=tier.lt_name,
        SourceVersion=str(latest["VersionNumber"]),
        LaunchTemplateData=data,
    )

    return result[
        "LaunchTemplateVersion"
    ]["VersionNumber"]
