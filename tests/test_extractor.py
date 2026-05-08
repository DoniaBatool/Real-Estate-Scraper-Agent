"""
Tests for the AI extractor — JSON parsing and OpenAI call mocking.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.ai.extractor import _truncate_html, _parse_json_safe, extract_data


# ---------------------------------------------------------------------------
# _truncate_html
# ---------------------------------------------------------------------------

def test_truncate_removes_script_tags():
    html = "<html><script>var x = 1;</script><body>Hello</body></html>"
    result = _truncate_html(html)
    assert "<script>" not in result
    assert "Hello" in result


def test_truncate_removes_style_tags():
    html = "<html><style>.foo{color:red}</style><body>World</body></html>"
    result = _truncate_html(html)
    assert "<style>" not in result
    assert "World" in result


def test_truncate_caps_length():
    html = "x" * 200_000
    assert len(_truncate_html(html)) <= 120_000


# ---------------------------------------------------------------------------
# _parse_json_safe
# ---------------------------------------------------------------------------

def test_parse_plain_json():
    raw = '{"agency_name": "Test Agency", "email": ["test@test.com"]}'
    result = _parse_json_safe(raw)
    assert result["agency_name"] == "Test Agency"


def test_parse_json_in_code_fence():
    raw = '```json\n{"agency_name": "Fenced"}\n```'
    result = _parse_json_safe(raw)
    assert result["agency_name"] == "Fenced"


def test_parse_json_in_generic_fence():
    raw = '```\n{"agency_name": "Plain fence"}\n```'
    result = _parse_json_safe(raw)
    assert result["agency_name"] == "Plain fence"


def test_parse_json_brace_fallback():
    raw = 'Some preamble text {"agency_name": "Embedded"} trailing text'
    result = _parse_json_safe(raw)
    assert result["agency_name"] == "Embedded"


def test_parse_invalid_json_returns_empty():
    result = _parse_json_safe("not valid json at all")
    assert result == {}


# ---------------------------------------------------------------------------
# extract_data — mocked OpenAI call
# ---------------------------------------------------------------------------

SAMPLE_RESPONSE = {
    "agency_name": "Malta Homes Ltd",
    "owner_name": "John Doe",
    "email": ["info@maltahomes.com"],
    "phone": ["+356 2123 4567"],
    "whatsapp": "+35699123456",
    "facebook_url": None,
    "instagram_url": None,
    "linkedin_url": None,
    "twitter_url": None,
    "google_rating": 4.5,
    "review_count": 120,
    "price_range_min": 150000,
    "price_range_max": 800000,
    "currency": "EUR",
    "specialization": "residential",
    "description": "Leading property agency in Malta.",
    "logo_url": "https://maltahomes.com/logo.png",
    "properties": [
        {
            "title": "3-Bed Apartment in Sliema",
            "property_type": "apartment",
            "bedrooms": 3,
            "bathrooms": 2,
            "total_sqm": 120.0,
            "bedroom_sqm": 15.0,
            "bathroom_sqm": 5.0,
            "price": 350000.0,
            "price_per_sqm": 2916.67,
            "currency": "EUR",
            "locality": "Sliema",
            "district": "Northern",
            "city": "Valletta",
            "country": "Malta",
            "latitude": 35.9119,
            "longitude": 14.5028,
            "listing_date": "2026-04-01",
            "images": ["https://maltahomes.com/img/apt1.jpg"],
            "description": "Beautiful seafront apartment.",
            "amenities": ["parking", "pool", "gym"],
        }
    ],
}


def _make_mock_response(content: str):
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.mark.asyncio
async def test_extract_data_success():
    mock_create = AsyncMock(return_value=_make_mock_response(json.dumps(SAMPLE_RESPONSE)))

    with patch("backend.ai.extractor.AsyncOpenAI") as MockClient, \
         patch("backend.ai.extractor.settings") as mock_settings:
        mock_settings.openai_api_key = "sk-test"
        mock_settings.openai_model = "gpt-4o-mini"
        instance = MagicMock()
        instance.chat.completions.create = mock_create
        MockClient.return_value = instance

        result = await extract_data("<html>test</html>", "https://maltahomes.com")

    assert result["agency_name"] == "Malta Homes Ltd"
    assert result["email"] == ["info@maltahomes.com"]
    assert len(result["properties"]) == 1
    assert result["properties"][0]["bedrooms"] == 3


@pytest.mark.asyncio
async def test_extract_data_retries_on_empty_json():
    """Model returns empty string twice, then valid JSON on third attempt."""
    good_json = json.dumps({"agency_name": "Retry Agency"})
    responses = [
        _make_mock_response(""),
        _make_mock_response(""),
        _make_mock_response(good_json),
    ]
    mock_create = AsyncMock(side_effect=responses)

    with patch("backend.ai.extractor.AsyncOpenAI") as MockClient, \
         patch("backend.ai.extractor.settings") as mock_settings, \
         patch("backend.ai.extractor.asyncio.sleep"):
        mock_settings.openai_api_key = "sk-test"
        mock_settings.openai_model = "gpt-4o-mini"
        instance = MagicMock()
        instance.chat.completions.create = mock_create
        MockClient.return_value = instance

        result = await extract_data("<html>test</html>", "https://example.com")

    assert result["agency_name"] == "Retry Agency"
    assert mock_create.call_count == 3


@pytest.mark.asyncio
async def test_extract_data_no_api_key_returns_empty():
    with patch("backend.ai.extractor.settings") as mock_settings:
        mock_settings.openai_api_key = ""
        result = await extract_data("<html>test</html>", "https://example.com")
    assert result == {}


@pytest.mark.asyncio
async def test_extract_data_all_retries_fail_returns_empty():
    mock_create = AsyncMock(side_effect=Exception("API error"))

    with patch("backend.ai.extractor.AsyncOpenAI") as MockClient, \
         patch("backend.ai.extractor.settings") as mock_settings, \
         patch("backend.ai.extractor.asyncio.sleep"):
        mock_settings.openai_api_key = "sk-test"
        mock_settings.openai_model = "gpt-4o-mini"
        instance = MagicMock()
        instance.chat.completions.create = mock_create
        MockClient.return_value = instance

        result = await extract_data("<html>test</html>", "https://example.com")

    assert result == {}
    assert mock_create.call_count == 3
