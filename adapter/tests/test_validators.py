"""
Unit tests for NER entity validators

Tests IMO, MMSI, Flag, RFMO, and EU CFR validators with edge cases.
"""

import pytest
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ner.ner_config import (
    validate_imo,
    validate_mmsi,
    validate_flag,
    validate_rfmo,
    validate_eu_cfr,
    validate_entity,
    EntityType
)


class TestIMOValidator:
    """Test IMO number validation (7-digit Luhn algorithm)"""

    def test_valid_imo_numbers(self):
        """Valid IMO numbers with correct check digits"""
        assert validate_imo("9074729") is True  # Valid IMO
        assert validate_imo("8814275") is True  # Valid IMO
        assert validate_imo("9438169") is True  # Valid IMO (corrected check digit)

    def test_invalid_imo_check_digit(self):
        """Invalid IMO numbers with wrong check digits"""
        assert validate_imo("9074728") is False  # Wrong check digit
        assert validate_imo("8814276") is False  # Wrong check digit

    def test_invalid_imo_format(self):
        """Invalid IMO number formats"""
        assert validate_imo("123") is False  # Too short
        assert validate_imo("12345678") is False  # Too long
        assert validate_imo("IMO9074729") is False  # Has prefix (should be stripped before validation)
        assert validate_imo("abc1234") is False  # Contains letters
        assert validate_imo("") is False  # Empty string


class TestMMSIValidator:
    """Test MMSI validation with MID country code checks"""

    def test_valid_mmsi_numbers(self):
        """Valid MMSI numbers with known MID codes"""
        is_valid, metadata = validate_mmsi("316001234")  # Canada
        assert is_valid is True
        assert metadata["country"] == "Canada"
        assert metadata["mid"] == "316"

        is_valid, metadata = validate_mmsi("367123456")  # USA
        assert is_valid is True
        assert metadata["country"] == "USA"

        is_valid, metadata = validate_mmsi("232001234")  # UK
        assert is_valid is True
        assert metadata["country"] == "United Kingdom"

    def test_invalid_mmsi_format(self):
        """Invalid MMSI formats"""
        is_valid, metadata = validate_mmsi("12345")  # Too short
        assert is_valid is False
        assert "error" in metadata

        is_valid, metadata = validate_mmsi("1234567890")  # Too long
        assert is_valid is False

        is_valid, metadata = validate_mmsi("abcdefghi")  # Non-numeric
        assert is_valid is False

    def test_invalid_mmsi_mid_code(self):
        """MMSI with unknown MID codes"""
        is_valid, metadata = validate_mmsi("999123456")  # Unknown MID
        assert is_valid is False
        assert "error" in metadata
        assert "Unknown MID" in metadata["error"]


class TestFlagValidator:
    """Test flag country code validation (ISO 3166)"""

    def test_valid_alpha2_codes(self):
        """Valid ISO 3166 alpha-2 country codes"""
        assert validate_flag("US") is True
        assert validate_flag("GB") is True
        assert validate_flag("FR") is True
        assert validate_flag("CN") is True

    def test_valid_alpha3_codes(self):
        """Valid ISO 3166 alpha-3 country codes"""
        assert validate_flag("USA") is True
        assert validate_flag("GBR") is True
        assert validate_flag("FRA") is True
        assert validate_flag("CHN") is True

    def test_case_insensitivity(self):
        """Flag codes should be case-insensitive"""
        assert validate_flag("us") is True
        assert validate_flag("Us") is True
        assert validate_flag("usa") is True
        assert validate_flag("UsA") is True

    def test_invalid_flag_codes(self):
        """Invalid country codes"""
        assert validate_flag("XX") is False  # Not a real country
        assert validate_flag("ZZZ") is False  # Not a real country
        assert validate_flag("") is False  # Empty
        assert validate_flag("U") is False  # Too short


class TestRFMOValidator:
    """Test RFMO code validation"""

    def test_valid_rfmo_codes(self):
        """Valid RFMO codes"""
        assert validate_rfmo("CCAMLR") is True
        assert validate_rfmo("ICCAT") is True
        assert validate_rfmo("WCPFC") is True
        assert validate_rfmo("SEAFO") is True

    def test_case_insensitivity(self):
        """RFMO codes should be case-insensitive"""
        assert validate_rfmo("ccamlr") is True
        assert validate_rfmo("CcAmLr") is True
        assert validate_rfmo("ICCAT") is True
        assert validate_rfmo("iccat") is True

    def test_invalid_rfmo_codes(self):
        """Invalid RFMO codes"""
        assert validate_rfmo("INVALID") is False
        assert validate_rfmo("XXXX") is False
        assert validate_rfmo("") is False


class TestEUCFRValidator:
    """Test EU CFR (Community Fishing Registry) validation"""

    def test_valid_cfr_numbers(self):
        """Valid EU CFR numbers"""
        is_valid, metadata = validate_eu_cfr("FRA123456789")
        assert is_valid is True
        assert metadata["country_code"] == "FRA"

        is_valid, metadata = validate_eu_cfr("ESP999888777")
        assert is_valid is True
        assert metadata["country_code"] == "ESP"

        is_valid, metadata = validate_eu_cfr("GBR111222333")
        assert is_valid is True
        assert metadata["country_code"] == "GBR"

    def test_case_normalization(self):
        """CFR should handle lowercase input"""
        is_valid, metadata = validate_eu_cfr("fra123456789")
        assert is_valid is True
        assert metadata["country_code"] == "FRA"

    def test_invalid_cfr_format(self):
        """Invalid CFR formats"""
        is_valid, metadata = validate_eu_cfr("FR123456789")  # Only 2 letters
        assert is_valid is False
        assert "error" in metadata

        is_valid, metadata = validate_eu_cfr("FRAN123456789")  # 4 letters
        assert is_valid is False

        is_valid, metadata = validate_eu_cfr("FRA12345678")  # 8 digits
        assert is_valid is False

        is_valid, metadata = validate_eu_cfr("FRA1234567890")  # 10 digits
        assert is_valid is False

    def test_invalid_country_code(self):
        """CFR with invalid country codes"""
        is_valid, metadata = validate_eu_cfr("XXX123456789")
        assert is_valid is False
        assert "Invalid country code" in metadata["error"]


class TestValidateEntity:
    """Test the unified validate_entity() dispatcher"""

    def test_imo_validation(self):
        """Entity validation for IMO numbers"""
        is_valid, metadata = validate_entity(EntityType.IMO, "9074729")
        assert is_valid is True

        is_valid, metadata = validate_entity(EntityType.IMO, "9074728")
        assert is_valid is False

    def test_mmsi_validation(self):
        """Entity validation for MMSI numbers"""
        is_valid, metadata = validate_entity(EntityType.MMSI, "316001234")
        assert is_valid is True
        assert metadata is not None
        assert metadata["country"] == "Canada"

        is_valid, metadata = validate_entity(EntityType.MMSI, "999123456")
        assert is_valid is False
        assert "error" in metadata

    def test_flag_validation(self):
        """Entity validation for flag codes"""
        is_valid, metadata = validate_entity(EntityType.FLAG, "USA")
        assert is_valid is True

        is_valid, metadata = validate_entity(EntityType.FLAG, "XX")
        assert is_valid is False

    def test_rfmo_validation(self):
        """Entity validation for RFMO codes"""
        is_valid, metadata = validate_entity(EntityType.RFMO, "CCAMLR")
        assert is_valid is True

        is_valid, metadata = validate_entity(EntityType.RFMO, "INVALID")
        assert is_valid is False

    def test_eu_cfr_validation(self):
        """Entity validation for EU CFR numbers"""
        is_valid, metadata = validate_entity(EntityType.EU_CFR, "FRA123456789")
        assert is_valid is True
        assert metadata["country_code"] == "FRA"

        is_valid, metadata = validate_entity(EntityType.EU_CFR, "XXX123456789")
        assert is_valid is False
        assert "error" in metadata

    def test_no_validator_defined(self):
        """Entities without validators should pass by default"""
        # VESSEL_NAME has no specific validator
        is_valid, metadata = validate_entity(EntityType.VESSEL_NAME, "Any Text")
        assert is_valid is True
        assert metadata is None


class TestEdgeCases:
    """Test edge cases and boundary conditions"""

    def test_empty_strings(self):
        """Empty strings should fail validation"""
        assert validate_imo("") is False

        is_valid, _ = validate_mmsi("")
        assert is_valid is False

        assert validate_flag("") is False
        assert validate_rfmo("") is False

        is_valid, _ = validate_eu_cfr("")
        assert is_valid is False

    def test_whitespace_handling(self):
        """Whitespace should not be stripped (caller's responsibility)"""
        assert validate_imo(" 9074729 ") is False  # Should fail
        assert validate_flag(" USA ") is False

    def test_special_characters(self):
        """Special characters should be rejected"""
        assert validate_imo("9074729!") is False
        assert validate_flag("US$") is False
        assert validate_rfmo("ICCAT@") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
