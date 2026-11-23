"""DynamoDB access tests for the current Weather Advisor architecture."""

from types import SimpleNamespace

from stack.weather_policies import (
    weather_cache_policy,
    advisor_dynamodb_policy,
    dynamodb_table_arn,
)


def settings():
    return SimpleNamespace(region="us-east-2")


def test_weather_access_is_cache_only():
    policy = weather_cache_policy(
        settings(), "123456789012"
    )

    statement = policy["Statement"][0]
    resources = statement["Resource"]

    assert resources == dynamodb_table_arn(
        "us-east-2",
        "123456789012",
        "weather-advisor-cache",
    )
    assert "dynamodb:GetItem" in statement["Action"]
    assert "dynamodb:PutItem" in statement["Action"]
    assert "dynamodb:DeleteTable" not in statement["Action"]


def test_advisor_access_is_limited_to_two_tables():
    policy = advisor_dynamodb_policy(
        settings(), "123456789012"
    )

    statement = policy["Statement"][0]

    assert set(statement["Resource"]) == {
        dynamodb_table_arn(
            "us-east-2",
            "123456789012",
            "weather-advisor-cache",
        ),
        dynamodb_table_arn(
            "us-east-2",
            "123456789012",
            "weather-advisor-usage",
        ),
    }

    assert "dynamodb:DeleteTable" not in statement["Action"]
    assert "dynamodb:Scan" not in statement["Action"]
    assert "dynamodb:PutItem" in statement["Action"]
    assert "dynamodb:UpdateItem" in statement["Action"]


def test_table_arn_is_region_and_account_specific():
    assert dynamodb_table_arn(
        "us-east-2",
        "123456789012",
        "weather-advisor-cache",
    ) == (
        "arn:aws:dynamodb:us-east-2:123456789012:"
        "table/weather-advisor-cache"
    )
