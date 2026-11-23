"""Tests for the current DynamoDB-based Weather Advisor stack."""

import ast
import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from stack import weather_compute
from stack.weather_iam import expected_policies
from stack.weather_policies import parameter_arn


@pytest.fixture
def project_settings(tmp_path):
    weather = SimpleNamespace(
        name="weather",
        service_name="weather-advisor-weather",
        policy_name="WeatherAdvisorWeatherCache",
        lt_name="test-weather-lt",
        listener_port=8080,
        profile_name="test-weather-profile",
    )

    advisor = SimpleNamespace(
        name="advisor",
        service_name="weather-advisor-advisor",
        policy_name="WeatherAdvisorAdvisorCache",
        lt_name="test-advisor-lt",
        listener_port=8081,
        profile_name="test-advisor-profile",
    )

    artifact_dir = tmp_path / "deployment_artifacts"
    artifact_dir.mkdir()

    for name in ("weather", "advisor"):
        (artifact_dir / f"weather-advisor-{name}-test.zip").write_bytes(
            b"mock deployment package"
        )

    settings = SimpleNamespace(
        region="us-east-2",
        ami_id="ami-12345678",
        instance_type="t3.micro",
        key_name="test-key",
        app_sg_id="sg-12345678",
        base_dir=tmp_path,
        app_port=3000,
        weather=weather,
        advisor=advisor,
        cache_seconds=600,
        contact_email="weather-test@example.com",
        gemini_param_name="/test-weather/gemini-api-key",
        gemini_model="test-model",
        key_cache_seconds=60,
        usage_table="weather-advisor-usage",
        email_daily_limit=5,
        sns_topic_name="weather-advisor-final-reports",
    )

    return settings


def test_weather_role_cannot_access_advisor_secrets(project_settings):
    settings = project_settings

    policies = expected_policies(
        settings, settings.weather, "123456789012"
    )

    documents = str(policies)

    assert "ssm:GetParameter" not in documents
    assert "sns:Publish" not in documents
    assert "weather-advisor-cache" in documents
    assert "weather-advisor-usage" not in documents


def test_advisor_secret_is_restricted_to_parameter(project_settings):
    settings = project_settings

    policies = expected_policies(
        settings, settings.advisor, "123456789012"
    )

    policy = policies["WeatherAdvisorGeminiSSM"]
    statement = policy["Statement"][0]

    assert statement["Action"] == ["ssm:GetParameter"]
    assert statement["Resource"] == parameter_arn(
        settings.region,
        "123456789012",
        settings.gemini_param_name,
    )


def test_advisor_sns_policy_allows_isolated_registration_topics(project_settings):
    settings = project_settings

    policy = expected_policies(
        settings, settings.advisor, "123456789012"
    )["WeatherAdvisorSNSPublish"]

    statement = policy["Statement"][0]

    assert set(statement["Action"]) == {
        "sns:Publish",
        "sns:ListSubscriptionsByTopic",
    }

    assert set(statement["Resource"]) == {
        "arn:aws:sns:us-east-2:123456789012:"
        "weather-advisor-final-reports",
        "arn:aws:sns:us-east-2:123456789012:"
        "weather-advisor-recipient-b",
        "arn:aws:sns:us-east-2:123456789012:"
        "weather-advisor-user-*",
    }

    registration = policy["Statement"][1]
    assert set(registration["Action"]) == {"sns:CreateTopic", "sns:Subscribe"}
    assert registration["Resource"] == (
        "arn:aws:sns:us-east-2:123456789012:weather-advisor-user-*"
    )


def test_advisor_environment_has_two_recipients(project_settings):
    settings = project_settings

    environment = weather_compute.build_environment(
        settings,
        settings.advisor,
        "test-alb.invalid",
    )

    assert environment["SNS_TEST_RECIPIENT"] == (
        "bansari2204@gmail.com"
    )
    assert environment["SNS_SECOND_RECIPIENT"] == (
        "byadav1@hawk.illinoistech.edu"
    )
    assert environment["SNS_TOPIC_ARN"].endswith(
        ":weather-advisor-final-reports"
    )
    assert environment["SNS_SECOND_TOPIC_ARN"].endswith(
        ":weather-advisor-recipient-b"
    )
    assert environment["ENABLE_SNS_EMAIL"] == "true"


@pytest.mark.parametrize("tier_name", ["weather", "advisor"])
def test_python_bootstrap_under_16kb_and_secret_free(
    project_settings, tier_name
):
    settings = project_settings
    tier = getattr(settings, tier_name)

    script = weather_compute.build_user_data(
        settings,
        tier,
        "test-alb.invalid",
    )

    ast.parse(script)

    assert len(script.encode("utf-8")) < 16384
    assert script.startswith("#!/usr/bin/env python3")
    assert "#!/bin/bash" not in script
    assert "shell=True" not in script
    assert "mock-secret-value" not in script

    if tier_name == "advisor":
        assert settings.gemini_param_name in script
        assert "SNS_SECOND_TOPIC_ARN" in script
        assert "SNS_SECOND_RECIPIENT" in script
    else:
        assert "NWS_USER_AGENT" in script
        assert "SNS_SECOND_RECIPIENT" not in script


def test_launch_template_encodes_python_bootstrap(project_settings):
    settings = project_settings

    data = weather_compute.launch_template_data(
        settings,
        settings.advisor,
        "test-alb.invalid",
    )

    decoded = base64.b64decode(
        data["UserData"]
    ).decode("utf-8")

    assert decoded.startswith("#!/usr/bin/env python3")
    assert data["IamInstanceProfile"]["Name"] == (
        settings.advisor.profile_name
    )
    assert data["ImageId"] == settings.ami_id
    assert data["InstanceType"] == settings.instance_type

    ast.parse(decoded)


def test_launch_template_reuses_unchanged_version(
    project_settings, monkeypatch
):
    settings = project_settings
    tier = settings.advisor
    ec2 = Mock()
    aws = SimpleNamespace(ec2=ec2)

    expected_data = weather_compute.launch_template_data(
        settings, tier, "test-alb.invalid"
    )

    ec2.describe_launch_template_versions.return_value = {
        "LaunchTemplateVersions": [
            {
                "VersionNumber": 1,
                "LaunchTemplateData": expected_data,
            }
        ]
    }

    monkeypatch.setattr(
        "stack.compute.launch_template_exists",
        lambda aws_arg, tier_arg: True,
    )

    version = weather_compute.ensure_launch_template(
        aws, settings, tier, "test-alb.invalid"
    )

    assert version == 1
    ec2.create_launch_template_version.assert_not_called()
    ec2.create_launch_template.assert_not_called()
