
## Project Architecture and Workflow

The AI-Powered Weather Advisor is a cloud-based application deployed on AWS. It combines real-time weather forecast data, Google Gemini AI recommendations, DynamoDB caching, and Amazon SNS email delivery.

### End-to-End Architecture

```mermaid
flowchart TD
    A["User: ZIP Code, Date, Gender, Email"]
    B["AWS Application Load Balancer"]
    C["Advisor Service - Node.js / EC2"]
    D["Weather Service - Node.js / EC2"]
    E["National Weather Service + Open-Meteo"]
    F["DynamoDB Weather Cache"]
    G["Google Gemini AI"]
    H["Morning and Night Weather Report"]
    I{"Send Report to Email?"}
    J["Amazon SNS Email Confirmation"]
    K["Private Email Delivery"]

    A --> B
    B --> C
    C --> D
    D --> E
    D <--> F
    D --> C
    C --> G
    G --> C
    C --> H
    H --> I
    I -->|Yes| J
    J -->|Confirmed recipient| K
```

### How the Project Works

**Step 1 — User Input**

The user opens the publicly accessible Weather Advisor website and enters a valid five-digit US ZIP code, a forecast date within the supported seven-day window, and a clothing category. An email address is provided when requesting email delivery.

**Step 2 — Request Routing**

The AWS Application Load Balancer directs traffic to the Advisor and Weather application services running on Amazon EC2 instances managed by separate Auto Scaling Groups.

**Step 3 — Weather Data Retrieval**

The Weather Service retrieves forecast information from the National Weather Service and Open-Meteo. The application processes temperature, wind speed, humidity, visibility, UV, rainfall, and snowfall for Morning and Night periods.

**Step 4 — DynamoDB Caching**

Weather information is cached in Amazon DynamoDB to reduce unnecessary external API requests and improve repeat-request performance.

**Step 5 — AI Recommendations**

The Advisor Service sends structured weather facts to Google Gemini AI. Gemini generates practical recommendations for road conditions, clothing, and accessories. A rule-based fallback provides advice if Gemini is unavailable.

**Step 6 — Weather Report Generation**

The application displays a structured Morning and Night report containing ten required weather measurements, categories, and recommendations per period.

**Step 7 — Email Registration and Delivery**

Users can request their report by email. Amazon SNS manages recipient subscription confirmation. After confirmation, the system sends the report only to the intended recipient using a recipient-specific topic.

**Step 8 — Testing and Monitoring**

The application is validated using Python pytest, Node.js tests, AWS infrastructure health checks, and latency measurements. Failure and recovery behavior is also part of the testing design.

**Step 9 — AWS Cleanup**

After deployment and testing, Auto Scaling Groups are reduced to zero, EC2 instances are terminated, and the Application Load Balancer is deleted to limit ongoing AWS costs.

---

## Application Screenshots

### 1. Weather Advisor Website

![Weather Advisor Website](evidence/screenshot/05_weather_advisor_webpage.png)

### 2. Real Weather Report

![Real Weather Report](evidence/screenshot/04_real_weather_report.png)

### 3. Gemini AI Weather Recommendations

![Gemini Weather Report](evidence/screenshot/08_weather_report_gemini.png)

---

## Automated Testing Evidence

### Input Validation Tests

![Validation Tests](evidence/screenshot/01_validation_tests.png)

### Weather Logic Tests

![Weather Logic Tests](evidence/screenshot/02_weather_logic_tests.png)

### Rainfall and Snowfall Classification Tests

![Precipitation Tests](evidence/screenshot/03_precipitation_tests.png)

### Gemini Advice Tests

![Gemini Tests](evidence/screenshot/06_gemini_advice_tests.png)

---

## AWS Deployment Evidence

### Application Load Balancer

![ALB Active](evidence/screenshot/11_ALB_Active.png)

### Weather Target Group Health

![Weather Target Healthy](evidence/screenshot/09_Weather_Target_Healthy.png)

### Advisor Target Group Health

![Advisor Target Healthy](evidence/screenshot/10_Advisor_Target_Healthy.png)

### Auto Scaling Groups

![Auto Scaling Groups](evidence/screenshot/12_Auto_Scaling_Groups.png)

### EC2 Instances

![EC2 Instances](evidence/screenshot/13_EC2_Instances.png)

### Weather API Health

![Weather API Healthy](evidence/screenshot/17_Weather_API_Healthy.png)

### Two-Tier EC2 Deployment

![Two EC2 Instances](evidence/screenshot/20_EC2_Two_Tiers_Running.png)

### Two Auto Scaling Groups

![Two Auto Scaling Groups](evidence/screenshot/21_Two_Auto_Scaling_Groups.png)

---

## Email Confirmation and Delivery Evidence

### Email Consent Interface

![Email Consent](evidence/screenshot/18_Report_Email_Consent.png)

### Recipient B — Subscription Confirmation

![Recipient B Confirmation](evidence/screenshot/19_SNS_Recipient_B_Confirmed.png)

### Recipient A — Gmail Delivery

![Recipient A Gmail](evidence/screenshot/15_Recipient_A_Gmail_Delivered.png)

### Recipient B — Outlook Delivery

![Recipient B Outlook](evidence/screenshot/16_Recipient_B_Outlook_Delivered.png)

### New User Registration

![New User Registration](evidence/screenshot/22_new_user.png)

### Successful Email Delivery

![Email Delivery Success](evidence/screenshot/Email_Delivery_Success.png)

---

## Additional Screenshot Evidence

The following original evidence files are retained for completeness:

- [Additional Screenshot 09](evidence/screenshot/09_ss.png)
- [Recipient B Original Confirmation Screenshot](evidence/screenshot/14_Recipient_B_Confirmed.png%20in%20your%20final_evidence%20folder.png)

[**Browse all 23 project screenshots**](evidence/screenshot/)

---

## Test Results and Performance

The completed local test runs recorded:

| Test Suite | Results |
|---|---|
| Python tests | 30 passed |
| Weather Service Node.js tests | 18 passed |
| Advisor Service Node.js tests | 30 passed |
| **Total** | **78 passed** |

Initial public Advisor homepage latency results, based on 30 requests:

| Metric | Result |
|---|---|
| Average response time | 98.53 ms |
| Minimum response time | 57.63 ms |
| P95 response time | 195.97 ms |
| Maximum response time | 213.74 ms |
| Classroom SLO reference | 120 ms |

The average homepage response time was below the 120 ms target, while P95 exceeded it. These figures measure the Advisor homepage, not complete report generation.

Additional deployed integration, chaos, and recovery testing must be documented separately.

---

## Source Code and Documentation

- [Advisor Service](advisor-app/)
- [Weather Service](weather-app/)
- [AWS Infrastructure Code](stack/)
- [Automated Tests](tests/)
- [Deployment Script](create_weather_stack.py)
- [Cleanup Script](delete_weather_stack.py)
- [Budget Calculator](budget.py)
- [Final Project Report](FINAL_PROJECT_REPORT.md)
- [Submission Notes](SUBMISSION_NOTES.md)

## Security and Cost Management

The project uses separate IAM permissions for its application tiers, encrypted Gemini API key storage through AWS Systems Manager Parameter Store, validated user inputs, email subscription consent, per-user request controls, and DynamoDB item expiration.

The infrastructure was shut down after testing to avoid unnecessary running EC2 and ALB charges.

**Note:** The deployment screenshots document earlier successful AWS runs. The public application is only available when the cloud infrastructure is running.
