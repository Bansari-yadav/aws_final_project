"""Weather Advisor illustrative AWS budget calculator.

This does NOT call AWS or state actual charges. Update ALL unit prices with
current official us-east-2 pricing and provide real observed usage. EBS,
public IPv4, data transfer, taxes, free-tier credits, and third-party API
charges are separate inputs so that no costs are silently assumed away.

Example (PowerShell):
    python budget.py --instance-hour-rate 0.0104 --alb-hour-rate 0.0225 \
      --ec2-hours-per-tier 8 --alb-hours 8

The default values are deliberately ZERO and require explicit rate inputs.
"""

from __future__ import annotations

import argparse


def nonnegative(value: str) -> float:
    n = float(value)
    if n < 0:
        raise argparse.ArgumentTypeError("value must not be negative")
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = {
        "instance_hour_rate": "USD per EC2 instance hour",
        "ec2_hours_per_tier": "hours of operation of each of two tiers",
        "alb_hour_rate": "USD per ALB hour",
        "alb_hours": "ALB hours",
        "lcu_hour_rate": "USD per LCU-hour",
        "lcu_hours": "total ALB LCU-hours",
        "ebs_gb_month_rate": "USD per GB-month EBS",
        "ebs_gb_months": "billable EBS GB-months",
        "public_ipv4_hour_rate": "USD per public IPv4 hour",
        "public_ipv4_hours": "total billable public IPv4 hours",
        "dynamodb_read_million_rate": "USD per 1M DynamoDB reads",
        "dynamodb_read_count": "DynamoDB read requests",
        "dynamodb_write_million_rate": "USD per 1M DynamoDB writes",
        "dynamodb_write_count": "DynamoDB write requests",
        "dynamodb_gb_month_rate": "USD per GB-month DynamoDB storage",
        "dynamodb_gb_months": "DynamoDB storage GB-months",
        "s3_gb_month_rate": "USD per GB-month S3 storage",
        "s3_gb_months": "S3 storage GB-months",
        "s3_request_cost": "total S3 request cost USD",
        "sns_message_cost": "total SNS charges USD",
        "data_transfer_cost": "total data transfer charge USD",
        "gemini_cost": "total Gemini charge USD",
        "other_cost": "all other costs USD, including SSM when relevant",
        "credits": "AWS credits/free tier reductions USD",
        "budget": "budget threshold USD",
    }
    for name, description in inputs.items():
        parser.add_argument("--" + name.replace("_", "-"),
                            type=nonnegative,
                            default=2.0 if name == "budget" else 0.0,
                            help=description)
    a = parser.parse_args()
    cost = {
        "EC2 (2 tiers)": 2 * a.ec2_hours_per_tier * a.instance_hour_rate,
        "ALB base": a.alb_hours * a.alb_hour_rate,
        "ALB LCU": a.lcu_hours * a.lcu_hour_rate,
        "EBS": a.ebs_gb_months * a.ebs_gb_month_rate,
        "Public IPv4": a.public_ipv4_hours * a.public_ipv4_hour_rate,
        "DynamoDB reads": a.dynamodb_read_count / 1e6 * a.dynamodb_read_million_rate,
        "DynamoDB writes": a.dynamodb_write_count / 1e6 * a.dynamodb_write_million_rate,
        "DynamoDB storage": a.dynamodb_gb_months * a.dynamodb_gb_month_rate,
        "S3 storage": a.s3_gb_months * a.s3_gb_month_rate,
        "S3 requests": a.s3_request_cost,
        "SNS": a.sns_message_cost,
        "Data transfer": a.data_transfer_cost,
        "Gemini": a.gemini_cost,
        "Other": a.other_cost,
    }
    gross = sum(cost.values())
    net = max(0.0, gross - a.credits)
    print("WEATHER ADVISOR — ESTIMATE (NOT AWS BILLING)")
    print("Region to price separately: us-east-2; USD")
    for label, amount in cost.items():
        print(f"  {label:<22} ${amount:>9.4f}")
    print(f"  {'Gross':<22} ${gross:>9.4f}")
    print(f"  {'Credits':<22} ${a.credits:>9.4f}")
    print(f"  {'Estimated net':<22} ${net:>9.4f}")
    print(f"  {'Budget':<22} ${a.budget:>9.4f}")
    print("SCENARIO RESULT:", "UNDER budget" if net < a.budget else "AT/OVER budget")
    if gross == 0.0:
        print("WARNING: all cost inputs are zero; this is NOT a valid pricing estimate.")
    print("Validate against AWS Billing/Cost Explorer before claiming actual cost.")


if __name__ == "__main__":
    main()
