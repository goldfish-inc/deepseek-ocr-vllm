"""
NER Postprocessor for Schema-aligned Entity Extraction
Handles entity merging, validation, and database alignment
"""

import json
import re
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict
import numpy as np

from .ner_config import (
    EntityType,
    NER_LABELS,
    ENTITY_DB_MAPPINGS,
    EXTRACTION_PATTERNS,
    validate_imo,
    validate_entity,
    RFMO_CODES,
    GEAR_TYPES
)


class NERPostprocessor:
    """
    Postprocesses NER model outputs to align with Ebisu database schema
    """

    def __init__(self, confidence_threshold: float = 0.5):
        self.confidence_threshold = confidence_threshold
        self.entity_patterns = EXTRACTION_PATTERNS
        self.db_mappings = ENTITY_DB_MAPPINGS

    def process_predictions(
        self,
        text: str,
        token_predictions: List[int],
        tokens: List[str],
        confidences: Optional[List[float]] = None
    ) -> List[Dict[str, Any]]:
        """
        Process raw NER predictions and align with database schema

        Args:
            text: Original input text
            token_predictions: List of predicted label indices
            tokens: List of tokenized text
            confidences: Optional confidence scores for each prediction

        Returns:
            List of extracted entities with database alignment
        """
        # Convert predictions to entities
        raw_entities = self._tokens_to_entities(
            tokens, token_predictions, confidences
        )

        # Merge B-I-O sequences
        merged_entities = self._merge_bio_entities(raw_entities)

        # Validate and enhance entities
        enhanced_entities = self._enhance_entities(merged_entities, text)

        # Resolve overlaps and conflicts
        final_entities = self._resolve_conflicts(enhanced_entities)

        # Add database mappings
        entities_with_db = self._add_database_info(final_entities)

        return entities_with_db

    def _tokens_to_entities(
        self,
        tokens: List[str],
        predictions: List[int],
        confidences: Optional[List[float]] = None
    ) -> List[Dict[str, Any]]:
        """Convert token-level predictions to entity spans"""
        entities = []
        current_entity = None

        for i, (token, pred_idx) in enumerate(zip(tokens, predictions)):
            label = NER_LABELS[pred_idx] if pred_idx < len(NER_LABELS) else "O"
            conf = confidences[i] if confidences else 1.0

            # Handle special tokens
            if token in ["[CLS]", "[SEP]", "[PAD]"]:
                continue

            # Check for B-I-O tagging
            if label.startswith("B-"):
                # Start new entity
                if current_entity:
                    entities.append(current_entity)
                current_entity = {
                    "tokens": [token],
                    "label": label[2:],  # Remove B- prefix
                    "start_idx": i,
                    "end_idx": i,
                    "confidence": [conf]
                }
            elif label.startswith("I-") and current_entity:
                # Continue current entity
                if label[2:] == current_entity["label"]:
                    current_entity["tokens"].append(token)
                    current_entity["end_idx"] = i
                    current_entity["confidence"].append(conf)
            else:
                # Single token entity or O tag
                if current_entity:
                    entities.append(current_entity)
                    current_entity = None

                if label != "O":
                    entities.append({
                        "tokens": [token],
                        "label": label,
                        "start_idx": i,
                        "end_idx": i,
                        "confidence": [conf]
                    })

        # Don't forget last entity
        if current_entity:
            entities.append(current_entity)

        return entities

    def _merge_bio_entities(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Merge B-I-O tagged entities and calculate positions"""
        merged = []

        for entity in entities:
            # Reconstruct text from tokens
            text = " ".join(entity["tokens"])

            # Calculate average confidence
            avg_confidence = np.mean(entity["confidence"])

            if avg_confidence >= self.confidence_threshold:
                merged.append({
                    "text": text,
                    "label": entity["label"],
                    "token_start": entity["start_idx"],
                    "token_end": entity["end_idx"],
                    "confidence": float(avg_confidence),
                    "source": "model"
                })

        return merged

    def _enhance_entities(self, entities: List[Dict[str, Any]], full_text: str) -> List[Dict[str, Any]]:
        """Enhance entities with pattern matching and validation"""
        enhanced = list(entities)  # Copy existing entities

        # Add pattern-based extraction as fallback
        for entity_type, patterns in self.entity_patterns.items():
            entity_label = entity_type.value

            for pattern in patterns:
                for match in re.finditer(pattern, full_text, re.IGNORECASE):
                    matched_text = match.group(1) if match.groups() else match.group(0)

                    # Validate the match
                    if not validate_entity(entity_type, matched_text):
                        continue

                    # Check if already found by model
                    already_found = any(
                        e["text"].lower() == matched_text.lower() and
                        e["label"] == entity_label
                        for e in enhanced
                    )

                    if not already_found:
                        enhanced.append({
                            "text": matched_text,
                            "label": entity_label,
                            "start": match.start(),
                            "end": match.end(),
                            "confidence": 0.9,  # High confidence for pattern match
                            "source": "pattern"
                        })

        # Special handling for specific entity types
        enhanced = self._handle_special_entities(enhanced, full_text)

        return enhanced

    def _handle_special_entities(self, entities: List[Dict[str, Any]], text: str) -> List[Dict[str, Any]]:
        """Special handling for domain-specific entities"""
        enhanced = list(entities)

        # Enhance vessel names - often multi-word
        vessel_pattern = r"\b(?:M/V|MV|F/V|FV|S/V|SV)\s+([A-Z][A-Z\s]+)"
        for match in re.finditer(vessel_pattern, text):
            vessel_name = match.group(1).strip()
            enhanced.append({
                "text": vessel_name,
                "label": "VESSEL_NAME",
                "start": match.start(1),
                "end": match.end(1),
                "confidence": 0.85,
                "source": "pattern_vessel_prefix"
            })

        # Detect RFMOs
        for rfmo in RFMO_CODES:
            pattern = r"\b" + re.escape(rfmo) + r"\b"
            for match in re.finditer(pattern, text, re.IGNORECASE):
                enhanced.append({
                    "text": match.group(0),
                    "label": "RFMO",
                    "start": match.start(),
                    "end": match.end(),
                    "confidence": 0.95,
                    "source": "known_rfmo"
                })

        # Detect gear types
        for code, full_name in GEAR_TYPES.items():
            # Match both code and full name
            for term in [code, full_name]:
                pattern = r"\b" + re.escape(term) + r"\b"
                for match in re.finditer(pattern, text, re.IGNORECASE):
                    enhanced.append({
                        "text": match.group(0),
                        "label": "GEAR_TYPE",
                        "start": match.start(),
                        "end": match.end(),
                        "confidence": 0.9,
                        "source": "known_gear_type"
                    })

        return enhanced

    def _resolve_conflicts(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Resolve overlapping entities and conflicts"""
        if not entities:
            return []

        # Sort by start position and confidence
        sorted_entities = sorted(
            entities,
            key=lambda e: (e.get("start", e.get("token_start", 0)), -e["confidence"])
        )

        resolved = []
        last_end = -1

        for entity in sorted_entities:
            start = entity.get("start", entity.get("token_start", 0))
            end = entity.get("end", entity.get("token_end", start + len(entity["text"])))

            # Skip if overlaps with higher confidence entity
            if start < last_end:
                continue

            resolved.append(entity)
            last_end = end

        # Handle special cases where multiple labels might be valid
        resolved = self._handle_multi_label_entities(resolved)

        return resolved

    def _handle_multi_label_entities(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Handle cases where an entity can have multiple valid labels"""
        enhanced = []

        for entity in entities:
            enhanced.append(entity)

            # Person can also be vessel master or crew
            if entity["label"] == "PERSON":
                # Check context for role indicators
                text_lower = entity.get("context", "").lower()
                if "captain" in text_lower or "master" in text_lower:
                    enhanced.append({
                        **entity,
                        "label": "VESSEL_MASTER",
                        "confidence": entity["confidence"] * 0.9,
                        "derived_from": "PERSON"
                    })
                elif "engineer" in text_lower or "crew" in text_lower:
                    enhanced.append({
                        **entity,
                        "label": "CREW_MEMBER",
                        "confidence": entity["confidence"] * 0.9,
                        "derived_from": "PERSON"
                    })

            # Company can also be operator or owner
            elif entity["label"] == "COMPANY":
                text_lower = entity.get("context", "").lower()
                if "operat" in text_lower:
                    enhanced.append({
                        **entity,
                        "label": "OPERATOR",
                        "confidence": entity["confidence"] * 0.9,
                        "derived_from": "COMPANY"
                    })
                elif "own" in text_lower or "beneficial" in text_lower:
                    enhanced.append({
                        **entity,
                        "label": "BENEFICIAL_OWNER",
                        "confidence": entity["confidence"] * 0.9,
                        "derived_from": "COMPANY"
                    })

        return enhanced

    def _add_database_info(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Add database table and field information to entities"""
        enriched = []

        for entity in entities:
            label = entity["label"]
            entity_type = EntityType[label] if label in EntityType.__members__ else None

            if entity_type and entity_type in self.db_mappings:
                mapping = self.db_mappings[entity_type]
                entity["database"] = {
                    "table": mapping.table,
                    "primary_key": mapping.primary_key,
                    "fields": mapping.fields,
                    "foreign_keys": mapping.foreign_keys,
                    "where_clause": mapping.where_clause
                }

                # Add validation status
                entity["validated"] = validate_entity(entity_type, entity["text"])

            enriched.append(entity)

        return enriched

    def format_for_database(self, entities: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
        """
        Format extracted entities for database insertion

        Returns dict with table names as keys and records as values
        """
        db_records = defaultdict(list)

        for entity in entities:
            if "database" not in entity:
                continue

            db_info = entity["database"]
            table = db_info["table"]

            record = {
                "extracted_text": entity["text"],
                "confidence": entity["confidence"],
                "source": entity.get("source", "unknown")
            }

            # Add specific fields based on entity type
            if entity["label"] == "IMO":
                record["imo"] = entity["text"]
            elif entity["label"] == "VESSEL_NAME":
                record["vessel_name"] = entity["text"]
            elif entity["label"] == "MMSI":
                record["mmsi"] = entity["text"]
            # ... add more field mappings as needed

            db_records[table].append(record)

        return dict(db_records)


def create_postprocessor(config: Optional[Dict[str, Any]] = None) -> NERPostprocessor:
    """Factory function to create configured postprocessor"""
    config = config or {}
    return NERPostprocessor(
        confidence_threshold=config.get("confidence_threshold", 0.5)
    )


if __name__ == "__main__":
    # Example usage
    processor = create_postprocessor()

    # Simulate model output
    text = "The vessel OCEAN WARRIOR with IMO 1234567 is flagged in Panama"
    tokens = ["The", "vessel", "OCEAN", "WARRIOR", "with", "IMO", "1234567", "is", "flagged", "in", "Panama"]
    predictions = [0, 0, 2, 2, 0, 0, 3, 0, 0, 0, 6]  # Example label indices
    confidences = [0.9] * len(predictions)

    entities = processor.process_predictions(text, predictions, tokens, confidences)

    print(json.dumps(entities, indent=2))
