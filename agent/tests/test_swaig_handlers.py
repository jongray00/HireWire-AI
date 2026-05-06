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
