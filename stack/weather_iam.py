
"""IAM roles and instance profiles for Weather Advisor."""

import json

from botocore.exceptions import ClientError

from .network import StackError
from .policies import trust_policy
from .util import error_code, ignore_errors
from .weather_policies import (
    parameter_arn,
    weather_cache_policy,
    advisor_dynamodb_policy,
)


# --------------------------------------------------
# IAM policy names
# --------------------------------------------------

ADVISOR_GEMINI_POLICY = "WeatherAdvisorGeminiSSM"
ADVISOR_SNS_POLICY = "WeatherAdvisorSNSPublish"
ADVISOR_DYNAMODB_POLICY = "WeatherAdvisorDynamoDB"
ADVISOR_S3_POLICY = "WeatherAdvisorS3Read"

WEATHER_S3_POLICY = "WeatherAdvisorWeatherS3Read"


# --------------------------------------------------
# Expected IAM policies
# --------------------------------------------------

def expected_policies(settings, tier, account_id):
    """Define approved inline IAM policies for each service."""

    # ----------------------------------------------
    # Weather EC2 role
    # ----------------------------------------------

    if tier.name == "weather":
        return {
            tier.policy_name: weather_cache_policy(
                settings,
                account_id,
            ),

            WEATHER_S3_POLICY: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "ReadWeatherDeploymentPackage",
                        "Effect": "Allow",
                        "Action": [
                            "s3:GetObject",
                        ],
                        "Resource": (
                            f"arn:aws:s3:::weather-advisor-artifacts-"
                            f"{account_id}-{settings.region}/weather/*"
                        ),
                    }
                ],
            },
        }

    # ----------------------------------------------
    # Advisor EC2 role
    # ----------------------------------------------

    if tier.name == "advisor":

        gemini_parameter = parameter_arn(
            settings.region,
            account_id,
            settings.gemini_param_name,
        )

        sns_topic = (
            f"arn:aws:sns:{settings.region}:{account_id}:"
            "weather-advisor-final-reports"
        )

        second_sns_topic = (
            f"arn:aws:sns:{settings.region}:{account_id}:"
            "weather-advisor-recipient-b"
        )

        recipient_topic_pattern = (
            f"arn:aws:sns:{settings.region}:{account_id}:"
            "weather-advisor-user-*"
        )

        advisor_s3_objects = (
            f"arn:aws:s3:::weather-advisor-artifacts-"
            f"{account_id}-{settings.region}/advisor/*"
        )

        return {
            # --------------------------------------
            # Gemini API key stored in SSM
            # --------------------------------------

            ADVISOR_GEMINI_POLICY: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "ReadGeminiKey",
                        "Effect": "Allow",
                        "Action": [
                            "ssm:GetParameter",
                        ],
                        "Resource": gemini_parameter,
                    }
                ],
            },

            # --------------------------------------
            # Amazon SNS email delivery
            # --------------------------------------

            ADVISOR_SNS_POLICY: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "PublishWeatherAdvisorReports",
                        "Effect": "Allow",
                        "Action": [
                            "sns:Publish",
                            "sns:ListSubscriptionsByTopic",
                        ],
                        "Resource": [
                            sns_topic,
                            second_sns_topic,
                            recipient_topic_pattern,
                        ],
                    },
                    {
                        "Sid": "RegisterIsolatedRecipientTopics",
                        "Effect": "Allow",
                        "Action": [
                            "sns:CreateTopic",
                            "sns:Subscribe",
                        ],
                        "Resource": recipient_topic_pattern,
                    },
                ],
            },

            # --------------------------------------
            # DynamoDB advice cache and usage limits
            # --------------------------------------

            ADVISOR_DYNAMODB_POLICY: advisor_dynamodb_policy(
                settings,
                account_id,
            ),

            # --------------------------------------
            # Read Advisor deployment ZIP from S3
            # --------------------------------------

            ADVISOR_S3_POLICY: {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "ReadAdvisorDeploymentPackage",
                        "Effect": "Allow",
                        "Action": [
                            "s3:GetObject",
                        ],
                        "Resource": advisor_s3_objects,
                    }
                ],
            },
        }

    raise ValueError(f"Unknown tier: {tier.name}")


# --------------------------------------------------
# Create or update IAM role and instance profile
# --------------------------------------------------

def ensure_role_and_profile(
    aws,
    settings,
    tier,
    account_id,
):
    """Ensure the role, approved policies, and profile exist."""

    wanted_policies = expected_policies(
        settings,
        tier,
        account_id,
    )

    # Create the IAM role if it does not exist.
    with ignore_errors("EntityAlreadyExists"):
        aws.iam.create_role(
            RoleName=tier.role_name,
            AssumeRolePolicyDocument=json.dumps(
                trust_policy()
            ),
        )

    # Validate the role's trust policy.
    role = aws.iam.get_role(
        RoleName=tier.role_name
    )["Role"]

    if role["AssumeRolePolicyDocument"] != trust_policy():
        raise StackError(
            f"Unexpected trust policy for {tier.role_name}."
        )

    # Read existing inline policies.
    existing_names = set(
        aws.iam.list_role_policies(
            RoleName=tier.role_name
        )["PolicyNames"]
    )

    unexpected = existing_names - set(wanted_policies)

    if unexpected:
        raise StackError(
            f"Unexpected IAM policies on {tier.role_name}: "
            + ", ".join(sorted(unexpected))
        )

    # Reject unexpected managed policies.
    attached = aws.iam.list_attached_role_policies(
        RoleName=tier.role_name
    )["AttachedPolicies"]

    if attached:
        raise StackError(
            f"Unexpected managed policies on {tier.role_name}."
        )

    # Create or update the expected inline policies.
    for policy_name, wanted_document in wanted_policies.items():

        existing_document = None

        try:
            existing_document = aws.iam.get_role_policy(
                RoleName=tier.role_name,
                PolicyName=policy_name,
            )["PolicyDocument"]

        except ClientError as error:
            if error_code(error) != "NoSuchEntity":
                raise

        if existing_document != wanted_document:
            aws.iam.put_role_policy(
                RoleName=tier.role_name,
                PolicyName=policy_name,
                PolicyDocument=json.dumps(
                    wanted_document
                ),
            )

    # Create the instance profile if necessary.
    with ignore_errors("EntityAlreadyExists"):
        aws.iam.create_instance_profile(
            InstanceProfileName=tier.profile_name
        )

    profile = aws.iam.get_instance_profile(
        InstanceProfileName=tier.profile_name
    )["InstanceProfile"]

    role_names = {
        entry["RoleName"]
        for entry in profile["Roles"]
    }

    if role_names and role_names != {tier.role_name}:
        raise StackError(
            f"Unexpected role in profile {tier.profile_name}."
        )

    if not role_names:
        aws.iam.add_role_to_instance_profile(
            InstanceProfileName=tier.profile_name,
            RoleName=tier.role_name,
        )


# --------------------------------------------------
# Cleanup IAM role and instance profile
# --------------------------------------------------

def delete_role_and_profile(aws, tier):
    """Remove the specified tier's IAM resources during cleanup."""

    if tier.name == "advisor":
        policy_names = [
            ADVISOR_GEMINI_POLICY,
            ADVISOR_SNS_POLICY,
            ADVISOR_DYNAMODB_POLICY,
            ADVISOR_S3_POLICY,
        ]

    elif tier.name == "weather":
        policy_names = [
            tier.policy_name,
            WEATHER_S3_POLICY,
        ]

    else:
        raise ValueError(f"Unknown tier: {tier.name}")

    # Do not delete a role with unexpected policies.
    try:
        existing = set(
            aws.iam.list_role_policies(
                RoleName=tier.role_name
            )["PolicyNames"]
        )

    except ClientError as error:
        if error_code(error) == "NoSuchEntity":
            existing = set()
        else:
            raise

    if existing - set(policy_names):
        raise StackError(
            f"Refusing to delete {tier.role_name}: "
            "unexpected policies exist."
        )

    # Remove the role from its instance profile.
    with ignore_errors("NoSuchEntity"):
        aws.iam.remove_role_from_instance_profile(
            InstanceProfileName=tier.profile_name,
            RoleName=tier.role_name,
        )

    # Delete instance profile.
    with ignore_errors("NoSuchEntity"):
        aws.iam.delete_instance_profile(
            InstanceProfileName=tier.profile_name
        )

    # Delete approved inline policies.
    for policy_name in policy_names:
        with ignore_errors("NoSuchEntity"):
            aws.iam.delete_role_policy(
                RoleName=tier.role_name,
                PolicyName=policy_name,
            )

    # Delete the IAM role.
    with ignore_errors("NoSuchEntity"):
        aws.iam.delete_role(
            RoleName=tier.role_name
        )
