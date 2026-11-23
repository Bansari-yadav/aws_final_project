
"""Configuration for the Weather Advisor AWS deployment.

Weather and Advisor run on EC2 behind an ALB.
DynamoDB replaces the previous PostgreSQL/RDS dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import ConfigError, Tier, load_dotenv


@dataclass(frozen=True)
class WeatherSettings:
    """Validated configuration for the two application tiers."""

    region: str
    ami_id: str
    key_name: str
    instance_type: str
    app_sg_id: str

    alb_name: str
    alb_sg_name: str
    az_a: str
    az_b: str

    weather: Tier
    advisor: Tier

    cache_seconds: int
    gemini_param_name: str
    gemini_model: str
    key_cache_seconds: int
    contact_email: str

    base_dir: Path
    app_port: int

    # DynamoDB and SNS configuration.
    weather_cache_table: str = "weather-advisor-cache"
    usage_table: str = "weather-advisor-usage"
    sns_topic_name: str = "weather-advisor-final-reports"
    email_daily_limit: int = 5

    @property
    def tiers(self) -> tuple[Tier, Tier]:
        """Return both application tiers."""
        return self.weather, self.advisor

    def tier(self, name: str) -> Tier:
        """Find a tier by service name."""
        return {
            "weather": self.weather,
            "advisor": self.advisor,
        }[name]

    @classmethod
    def from_values(
        cls,
        values: dict[str, str],
        base_dir: str | Path = ".",
    ) -> "WeatherSettings":
        """Validate environment values and build settings."""

        required = [
            "AWS_REGION",
            "AMI_ID",
            "KEY_NAME",
            "INSTANCE_TYPE",
            "APP_PORT",
            "APP_SECURITY_GROUP_ID",
            "ALB_NAME",
            "ALB_SG_NAME",
            "AZ_A",
            "AZ_B",
            "CACHE_SECONDS",
            "GEMINI_PARAM_NAME",
            "GEMINI_MODEL",
            "KEY_CACHE_SECONDS",
            "CONTACT_EMAIL",
        ]

        tier_suffixes = [
            "ROLE_NAME",
            "PROFILE_NAME",
            "LT_NAME",
            "TG_NAME",
            "ASG_NAME",
            "LISTENER_PORT",
        ]

        for prefix in ("WEATHER", "ADVISOR"):
            required.extend(
                f"{prefix}_{suffix}"
                for suffix in tier_suffixes
            )

        missing = [
            key
            for key in required
            if not values.get(key)
        ]

        if missing:
            raise ConfigError(
                "Missing settings: " + ", ".join(missing)
            )

        if values["AZ_A"] == values["AZ_B"]:
            raise ConfigError(
                "AZ_A and AZ_B must be different."
            )

        base = Path(base_dir).resolve()

        def positive_integer(name: str) -> int:
            """Read and validate a positive integer."""
            try:
                value = int(values[name])
            except (ValueError, TypeError) as error:
                raise ConfigError(
                    f"{name} must be an integer."
                ) from error

            if value <= 0:
                raise ConfigError(
                    f"{name} must be positive."
                )

            return value

        def optional_positive_integer(
            name: str,
            default: int,
        ) -> int:
            """Read an optional positive integer."""
            raw = values.get(name)

            if raw is None or raw == "":
                return default

            try:
                value = int(raw)
            except (ValueError, TypeError) as error:
                raise ConfigError(
                    f"{name} must be an integer."
                ) from error

            if value <= 0:
                raise ConfigError(
                    f"{name} must be positive."
                )

            return value

        def make_tier(prefix: str) -> Tier:
            """Build a tier using the existing Tier class."""
            port_name = f"{prefix}_LISTENER_PORT"

            port = positive_integer(port_name)

            if port > 65535:
                raise ConfigError(
                    f"{port_name} must be at most 65535."
                )

            return Tier(
                name=prefix.lower(),
                role_name=values[f"{prefix}_ROLE_NAME"],
                profile_name=values[f"{prefix}_PROFILE_NAME"],
                lt_name=values[f"{prefix}_LT_NAME"],
                tg_name=values[f"{prefix}_TG_NAME"],
                asg_name=values[f"{prefix}_ASG_NAME"],
                listener_port=port,
                app_dir=base / f"{prefix.lower()}-app",
            )

        weather = make_tier("WEATHER")
        advisor = make_tier("ADVISOR")

        if weather.listener_port == advisor.listener_port:
            raise ConfigError(
                "Weather and Advisor listener ports must differ."
            )

        app_port = positive_integer("APP_PORT")

        if app_port > 65535:
            raise ConfigError(
                "APP_PORT must be at most 65535."
            )

        cache_seconds = positive_integer("CACHE_SECONDS")

        key_cache_seconds = positive_integer(
            "KEY_CACHE_SECONDS"
        )

        return cls(
            region=values["AWS_REGION"],
            ami_id=values["AMI_ID"],
            key_name=values["KEY_NAME"],
            instance_type=values["INSTANCE_TYPE"],
            app_sg_id=values["APP_SECURITY_GROUP_ID"],

            alb_name=values["ALB_NAME"],
            alb_sg_name=values["ALB_SG_NAME"],
            az_a=values["AZ_A"],
            az_b=values["AZ_B"],

            weather=weather,
            advisor=advisor,

            cache_seconds=cache_seconds,
            gemini_param_name=values["GEMINI_PARAM_NAME"],
            gemini_model=values["GEMINI_MODEL"],
            key_cache_seconds=key_cache_seconds,
            contact_email=values["CONTACT_EMAIL"],

            base_dir=base,
            app_port=app_port,

            weather_cache_table=values.get(
                "WEATHER_CACHE_TABLE",
                "weather-advisor-cache",
            ),
            usage_table=values.get(
                "GEMINI_USAGE_TABLE",
                "weather-advisor-usage",
            ),
            sns_topic_name=values.get(
                "SNS_TOPIC_NAME",
                "weather-advisor-final-reports",
            ),
            email_daily_limit=optional_positive_integer(
                "EMAIL_DAILY_LIMIT",
                5,
            ),
        )

    @classmethod
    def from_file(
        cls,
        path: str | Path = ".env",
    ) -> "WeatherSettings":
        """Load settings relative to an environment file."""

        path = Path(path).resolve()

        return cls.from_values(
            load_dotenv(path),
            base_dir=path.parent,
        )
