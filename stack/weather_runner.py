
"""Deploy the Weather Advisor AWS application stack.

Creates the Weather and Advisor tiers using:
- EC2 launch templates
- Auto Scaling Groups
- Application Load Balancer
- DynamoDB-backed applications
- Private S3 deployment packages

No RDS database is required.
"""

import json
import time

from . import balancer, network, scaling
from . import weather_compute, weather_iam
from .network import StackError


def check_prerequisites(aws, settings):
    """Validate prerequisites without creating AWS resources."""

    # Verify Gemini API key parameter metadata.
    parameters = aws.ssm.describe_parameters(
        ParameterFilters=[
            {
                "Key": "Name",
                "Option": "Equals",
                "Values": [settings.gemini_param_name],
            }
        ]
    )["Parameters"]

    if (
        not parameters
        or parameters[0]["Type"] != "SecureString"
    ):
        raise StackError(
            "Gemini SecureString parameter is missing."
        )

    # Verify both local deployment packages exist.
    packages = {}

    for tier in settings.tiers:
        package = weather_compute.find_deployment_package(
            settings,
            tier.name,
        )

        if not package.is_file():
            raise StackError(
                f"Deployment package missing: {package}"
            )

        packages[tier.name] = package

    return packages


def create_weather_stack(
    aws,
    settings,
    account_id,
    iam_wait=15,
    sleep=time.sleep,
):
    """Create both EC2 tiers and save resource identifiers."""

    print("Checking deployment prerequisites...")

    packages = check_prerequisites(
        aws,
        settings,
    )

    for service, package in packages.items():
        print(
            f"{service.capitalize()} package: "
            f"{package.name}"
        )

    print("Ensuring IAM roles and instance profiles...")

    for tier in settings.tiers:
        weather_iam.ensure_role_and_profile(
            aws,
            settings,
            tier,
            account_id,
        )

    print(
        f"Waiting {iam_wait} seconds "
        "for IAM propagation..."
    )
    sleep(iam_wait)

    print("Finding VPC and subnets...")

    vpc_id = network.default_vpc_id(aws)

    subnet_a = network.subnet_in_az(
        aws,
        vpc_id,
        settings.az_a,
    )

    subnet_b = network.subnet_in_az(
        aws,
        vpc_id,
        settings.az_b,
    )

    print("Ensuring security groups...")

    alb_sg_id = network.ensure_alb_security_group(
        aws,
        settings,
        vpc_id,
    )

    network.restrict_app_security_group(
        aws,
        settings,
        alb_sg_id,
    )

    print("Ensuring target groups...")

    target_groups = {
        tier.name: balancer.ensure_target_group(
            aws,
            settings,
            tier,
            vpc_id,
        )
        for tier in settings.tiers
    }

    print("Ensuring Application Load Balancer...")

    alb_arn, alb_dns = balancer.ensure_load_balancer(
        aws,
        settings,
        [subnet_a, subnet_b],
        alb_sg_id,
    )

    print("Ensuring ALB listeners...")

    for tier in settings.tiers:
        balancer.ensure_listener(
            aws,
            alb_arn,
            tier.listener_port,
            target_groups[tier.name],
        )

    print("Ensuring EC2 launch templates...")

    for tier in settings.tiers:
        weather_compute.ensure_launch_template(
            aws,
            settings,
            tier,
            alb_dns,
        )

    print("Ensuring Auto Scaling Groups...")

    for tier in settings.tiers:
        scaling.ensure_asg(
            aws,
            tier,
            target_groups[tier.name],
            [subnet_a, subnet_b],
        )

    outputs = {
        "VPC_ID": vpc_id,
        "SUBNET_A": subnet_a,
        "SUBNET_B": subnet_b,
        "ALB_SECURITY_GROUP_ID": alb_sg_id,
        "ALB_ARN": alb_arn,
        "ALB_DNS_NAME": alb_dns,
        "WEATHER_TG_ARN": target_groups["weather"],
        "ADVISOR_TG_ARN": target_groups["advisor"],
    }

    output_env = settings.base_dir / "stack_outputs.env"
    output_json = settings.base_dir / "stack_outputs.json"

    output_env.write_text(
        "".join(
            f"{key}={value}\n"
            for key, value in outputs.items()
        ),
        encoding="utf-8",
    )

    output_json.write_text(
        json.dumps(outputs, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Weather Advisor stack creation complete.")

    print(
        f"Weather: http://{alb_dns}:"
        f"{settings.weather.listener_port}/"
    )

    print(
        f"Advisor: http://{alb_dns}:"
        f"{settings.advisor.listener_port}/"
    )

    print(
        "Verify target group health before "
        "testing application endpoints."
    )

    return outputs


def delete_weather_stack(
    aws,
    settings,
    sleep=time.sleep,
):
    """Delete application infrastructure.

    WARNING: This also deletes specified IAM roles
    and instance profiles. Do not use until resource
    ownership and cleanup scope have been verified.

    The S3 deployment bucket, DynamoDB tables,
    SNS topic and Gemini parameter are preserved.
    """

    from .compute import delete_launch_template
    from .util import retry_on

    print("Deleting Auto Scaling Groups...")

    for tier in settings.tiers:
        scaling.delete_asg(
            aws,
            tier.asg_name,
            sleep=sleep,
        )

    remaining = [
        tier.asg_name
        for tier in settings.tiers
        if scaling.find_asg(
            aws,
            tier.asg_name,
        ) is not None
    ]

    if remaining:
        raise StackError(
            "Auto Scaling Groups are still deleting: "
            + ", ".join(remaining)
        )

    print("Deleting Application Load Balancer...")

    balancer.delete_load_balancer(
        aws,
        settings.alb_name,
    )

    print("Deleting target groups...")

    for tier in settings.tiers:
        retry_on(
            {"ResourceInUse"},
            lambda t=tier: balancer.delete_target_group(
                aws,
                t.tg_name,
            ),
            attempts=12,
            delay=10,
            sleep=sleep,
        )

    print("Restoring application security group...")

    vpc_id = network.default_vpc_id(aws)

    alb_sg_id = network.find_security_group(
        aws,
        settings.alb_sg_name,
        vpc_id,
    )

    network.restore_app_security_group(
        aws,
        settings,
        alb_sg_id,
    )

    if alb_sg_id:
        network.delete_alb_security_group(
            aws,
            alb_sg_id,
            sleep=sleep,
        )

    print("Deleting EC2 launch templates...")

    for tier in settings.tiers:
        delete_launch_template(
            aws,
            tier,
        )

    print("Deleting specified IAM resources...")

    for tier in settings.tiers:
        weather_iam.delete_role_and_profile(
            aws,
            tier,
        )

    for filename in (
        "stack_outputs.env",
        "stack_outputs.json",
    ):
        (
            settings.base_dir / filename
        ).unlink(missing_ok=True)

    print("Application stack removed.")

    print(
        "S3 packages, DynamoDB tables, SNS topic "
        "and Gemini parameter were not deleted."
    )
