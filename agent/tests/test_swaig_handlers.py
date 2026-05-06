"""Tests for agent/swaig_handlers.py — the SWAIG handler registry module."""
import pytest

from agent import swaig_handlers


def test_module_exposes_all_schemas():
    """Every SWAIG tool that appears in the live agent must have a schema constant."""
    assert hasattr(swaig_handlers, "TRANSFER_TO_HUMAN")
    assert hasattr(swaig_handlers, "SEND_SUMMARY_SMS")
    assert hasattr(swaig_handlers, "SCHEDULE_CALLBACK")
    assert hasattr(swaig_handlers, "CHECK_BUSINESS_HOURS")
    assert hasattr(swaig_handlers, "COLLECT_CUSTOMER_INFO")
    assert hasattr(swaig_handlers, "SEND_EMAIL")


def test_schemas_have_required_fields():
    """Each schema must have name, description, parameters."""
    for schema_name in [
        "TRANSFER_TO_HUMAN", "SEND_SUMMARY_SMS", "SCHEDULE_CALLBACK",
        "CHECK_BUSINESS_HOURS", "COLLECT_CUSTOMER_INFO", "SEND_EMAIL",
    ]:
        schema = getattr(swaig_handlers, schema_name)
        assert "name" in schema, f"{schema_name} missing 'name'"
        assert "description" in schema, f"{schema_name} missing 'description'"
        assert "parameters" in schema, f"{schema_name} missing 'parameters'"


def test_post_prompt_template_is_string():
    assert isinstance(swaig_handlers.POST_PROMPT_TEMPLATE, str)
    assert "JSON" in swaig_handlers.POST_PROMPT_TEMPLATE
    assert "summary" in swaig_handlers.POST_PROMPT_TEMPLATE


# ---- Handler tests ----------------------------------------------------------

def test_clean_phone_number_strips_formatting():
    assert swaig_handlers.clean_phone_number("(555) 123-4567") == "+5551234567"
    assert swaig_handlers.clean_phone_number("+1 555 123 4567") == "+15551234567"
    assert swaig_handlers.clean_phone_number("") == ""


def test_transfer_to_human_no_number_configured():
    config = {"id": "e1"}
    result = swaig_handlers.transfer_to_human(config, {"department": "sales"}, {})
    assert "no transfer number configured" in str(result.response).lower() or \
           "take a message" in str(result.response).lower()


def test_send_summary_sms_invalid_number():
    config = {"id": "e1", "sms_from_number": "+15555550000", "name": "Bot"}
    result = swaig_handlers.send_summary_sms(
        config, {"phone_number": "abc", "message": "hi"}, {}
    )
    assert "valid phone number" in str(result.response).lower()


def test_send_summary_sms_no_from_number():
    config = {"id": "e1", "name": "Bot"}
    result = swaig_handlers.send_summary_sms(
        config, {"phone_number": "+15551234567", "message": "hi"}, {}
    )
    assert "not set up" in str(result.response).lower() or \
           "noted the summary" in str(result.response).lower()


def test_check_business_hours_returns_open_or_closed():
    config = {"business_hours_start": 0, "business_hours_end": 24,
              "business_days": [0, 1, 2, 3, 4, 5, 6]}
    result = swaig_handlers.check_business_hours(config, {}, {})
    # 24/7 hours → "currently open"
    assert "currently open" in str(result.response).lower()


def test_schedule_callback_records_request():
    config = {"id": "e1"}
    result = swaig_handlers.schedule_callback(
        config,
        {"caller_name": "Alice", "callback_number": "+15551234567",
         "preferred_time": "tomorrow 3pm", "reason": "demo"},
        {},
    )
    assert "alice" in str(result.response).lower()


def test_collect_customer_info_records_fields():
    config = {"id": "e1"}
    result = swaig_handlers.collect_customer_info(
        config, {"name": "Bob", "email": "b@x.com"}, {}
    )
    # Handler returns a SwaigFunctionResult acknowledging collected fields.
    assert result is not None


def test_send_email_invalid_address():
    config = {"id": "e1"}
    result = swaig_handlers.send_email(
        config, {"to_email": "not-an-email", "subject": "s", "body": "b"}, {}
    )
    assert "valid email" in str(result.response).lower()


def test_send_email_no_sendgrid_config():
    config = {"id": "e1"}
    result = swaig_handlers.send_email(
        config, {"to_email": "a@b.com", "subject": "s", "body": "b"}, {}
    )
    assert "isn't set up" in str(result.response).lower() or \
           "not_configured" in str(result.response).lower() or \
           "take a note" in str(result.response).lower()


def test_handlers_registry_has_all_six():
    assert set(swaig_handlers.HANDLERS.keys()) == {
        "transfer_to_human", "send_summary_sms", "schedule_callback",
        "check_business_hours", "collect_customer_info", "send_email",
    }
