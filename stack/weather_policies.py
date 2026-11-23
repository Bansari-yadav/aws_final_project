
"""Least-privilege policies for Weather Advisor services."""

from .config import Tier
from .weather_config import WeatherSettings


def parameter_arn(region: str, account_id: str, name: str) -> str:
    """Build an SSM parameter ARN without reading its value."""
    return (
        f"arn:aws:ssm:{region}:{account_id}:"
        f"parameter/{name.lstrip('/')}"
    )


def dynamodb_table_arn(
    region: str,
    account_id: str,
    table_name: str,
) -> str:
    """Build an ARN for one DynamoDB table."""
    return (
        f"arn:aws:dynamodb:{region}:{account_id}:"
        f"table/{table_name}"
    )


def weather_cache_policy(
    settings: WeatherSettings,
    account_id: str,
) -> dict:
    """Allow Weather instances to access only the weather cache."""
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "WeatherCacheAccess",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                ],
                "Resource": dynamodb_table_arn(
                    settings.region,
                    account_id,
                    "weather-advisor-cache",
                ),
            }
        ],
    }


def advisor_dynamodb_policy(
    settings: WeatherSettings,
    account_id: str,
) -> dict:
    """Allow Advisor access to advice cache and usage counters."""
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "WeatherAdvisorDynamoDBAccess",
                "Effect": "Allow",
                "Action": [
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:UpdateItem",
                ],
                "Resource": [
                    dynamodb_table_arn(
                        settings.region,
                        account_id,
                        "weather-advisor-cache",
                    ),
                    dynamodb_table_arn(
                        settings.region,
                        account_id,
                        "weather-advisor-usage",
                    ),
                ],
            }
        ],
    }
