"""
NER Evaluator Tests for Regression Detection
Ensures NER system correctly extracts entities aligned with Ebisu database schema
"""

import json
import unittest
from typing import List, Dict, Any, Tuple
from collections import defaultdict
import numpy as np

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ner import NER_LABELS, EntityType, validate_imo, NERPostprocessor


class NERMetrics:
    """Calculate NER evaluation metrics"""

    @staticmethod
    def calculate_overlap(pred_start: int, pred_end: int, gold_start: int, gold_end: int) -> float:
        """Calculate overlap between predicted and gold spans"""
        overlap_start = max(pred_start, gold_start)
        overlap_end = min(pred_end, gold_end)

        if overlap_start >= overlap_end:
            return 0.0

        overlap = overlap_end - overlap_start
        gold_span = gold_end - gold_start

        return overlap / gold_span if gold_span > 0 else 0.0

    @staticmethod
    def evaluate_entities(
        predicted: List[Dict[str, Any]],
        gold: List[Dict[str, Any]],
        overlap_threshold: float = 0.5
    ) -> Dict[str, Any]:
        """
        Evaluate predicted entities against gold standard

        Returns:
            Dictionary with precision, recall, F1 scores
        """
        # Track matches per entity type
        type_metrics = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})

        # Mark which gold entities were found
        gold_matched = [False] * len(gold)

        # Check each predicted entity
        for pred in predicted:
            pred_label = pred["label"]
            pred_start = pred.get("start", 0)
            pred_end = pred.get("end", pred_start + len(pred["text"]))

            # Find best matching gold entity
            best_match_idx = -1
            best_overlap = 0.0

            for i, gold_ent in enumerate(gold):
                gold_start = gold_ent["start"]
                gold_end = gold_ent["end"]

                overlap = NERMetrics.calculate_overlap(
                    pred_start, pred_end, gold_start, gold_end
                )

                if overlap > best_overlap and overlap >= overlap_threshold:
                    best_overlap = overlap
                    best_match_idx = i

            if best_match_idx >= 0:
                gold_ent = gold[best_match_idx]

                if pred_label == gold_ent["label"]:
                    # True positive
                    type_metrics[pred_label]["tp"] += 1
                    gold_matched[best_match_idx] = True
                else:
                    # Wrong label - counts as FP for predicted, FN for gold
                    type_metrics[pred_label]["fp"] += 1
                    type_metrics[gold_ent["label"]]["fn"] += 1
                    gold_matched[best_match_idx] = True
            else:
                # False positive - no match
                type_metrics[pred_label]["fp"] += 1

        # Count false negatives (gold entities not matched)
        for i, gold_ent in enumerate(gold):
            if not gold_matched[i]:
                type_metrics[gold_ent["label"]]["fn"] += 1

        # Calculate metrics
        results = {"by_type": {}}
        total_tp = total_fp = total_fn = 0

        for entity_type, counts in type_metrics.items():
            tp = counts["tp"]
            fp = counts["fp"]
            fn = counts["fn"]

            precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

            results["by_type"][entity_type] = {
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "support": tp + fn  # Number of gold entities
            }

            total_tp += tp
            total_fp += fp
            total_fn += fn

        # Overall metrics
        overall_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
        overall_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
        overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) \
            if (overall_precision + overall_recall) > 0 else 0.0

        results["overall"] = {
            "precision": overall_precision,
            "recall": overall_recall,
            "f1": overall_f1,
            "total_predicted": len(predicted),
            "total_gold": len(gold),
            "total_correct": total_tp
        }

        return results


class TestNERSystem(unittest.TestCase):
    """Test NER system with fixtures"""

    def setUp(self):
        """Load test fixtures"""
        fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "ebisu_ner_test_fixtures.json")
        with open(fixture_path, "r") as f:
            self.fixtures = json.load(f)["test_fixtures"]

        self.postprocessor = NERPostprocessor(confidence_threshold=0.5)
        self.metrics = NERMetrics()

    def test_imo_extraction(self):
        """Test IMO number extraction and validation"""
        test_case = next(f for f in self.fixtures if f["id"] == "vessel_basic_01")

        # Simulate extraction
        entities = self.postprocessor._enhance_entities([], test_case["text"])

        # Find IMO entities
        imo_entities = [e for e in entities if e["label"] == "IMO"]

        self.assertGreater(len(imo_entities), 0, "Should extract IMO number")

        # Check if correct IMO was found
        found_imo = any(e["text"] == "9876543" for e in imo_entities)
        self.assertTrue(found_imo, "Should extract correct IMO number")

    def test_ircs_extraction(self):
        """Test IRCS extraction"""
        test_case = next(f for f in self.fixtures if f["id"] == "vessel_basic_01")

        entities = self.postprocessor._enhance_entities([], test_case["text"])

        # Check for IRCS (needs context awareness)
        text_with_context = test_case["text"]
        # The postprocessor should identify V2AB3 as IRCS based on context
        ircs_found = any(
            e["label"] == "IRCS" and "V2AB3" in e["text"]
            for e in entities
        )

        self.assertTrue(ircs_found, "Should extract IRCS with context")

    def test_vessel_ownership(self):
        """Test extraction of ownership relationships"""
        test_case = next(f for f in self.fixtures if f["id"] == "vessel_ownership_01")

        entities = self.postprocessor._enhance_entities([], test_case["text"])

        # Check for operator
        operator_found = any(
            "Blue Ocean Shipping" in e["text"]
            for e in entities
        )
        self.assertTrue(operator_found, "Should extract operator company")

        # Check for owner
        owner_found = any(
            "Maritime Holdings" in e["text"]
            for e in entities
        )
        self.assertTrue(owner_found, "Should extract owner company")

    def test_rfmo_gear_species(self):
        """Test RFMO, gear type, and species extraction"""
        test_case = next(f for f in self.fixtures if f["id"] == "vessel_rfmo_01")

        entities = self.postprocessor._enhance_entities([], test_case["text"])

        # Check RFMOs
        rfmos = [e for e in entities if e["label"] == "RFMO"]
        rfmo_texts = [e["text"].upper() for e in rfmos]

        self.assertIn("ICCAT", rfmo_texts, "Should extract ICCAT")
        self.assertIn("IOTC", rfmo_texts, "Should extract IOTC")

        # Check gear type
        gear_found = any(
            e["label"] == "GEAR_TYPE" and "purse seine" in e["text"].lower()
            for e in entities
        )
        self.assertTrue(gear_found, "Should extract gear type")

    def test_complex_vessel(self):
        """Test complex vessel with multiple identifiers"""
        test_case = next(f for f in self.fixtures if f["id"] == "complex_vessel_01")

        entities = self.postprocessor._enhance_entities([], test_case["text"])

        # Evaluate against expected
        metrics = self.metrics.evaluate_entities(
            entities,
            test_case["expected_entities"],
            overlap_threshold=0.5
        )

        # Should have reasonable performance
        self.assertGreater(metrics["overall"]["f1"], 0.6,
                          f"F1 score too low: {metrics['overall']['f1']}")

        # Check critical entity types
        for entity_type in ["IMO", "VESSEL_NAME", "RFMO"]:
            if entity_type in metrics["by_type"]:
                type_metrics = metrics["by_type"][entity_type]
                self.assertGreater(type_metrics["recall"], 0.5,
                                 f"Low recall for {entity_type}: {type_metrics['recall']}")

    def test_database_alignment(self):
        """Test database schema alignment"""
        test_text = "Vessel PACIFIC STAR (IMO 1234567) owned by Global Shipping Ltd"

        entities = self.postprocessor._enhance_entities([], test_text)
        entities_with_db = self.postprocessor._add_database_info(entities)

        # Check IMO has database info
        imo_entities = [e for e in entities_with_db if e["label"] == "IMO"]
        if imo_entities:
            imo = imo_entities[0]
            self.assertIn("database", imo)
            self.assertEqual(imo["database"]["table"], "vessels")
            self.assertIn("imo", imo["database"]["fields"])

    def test_imo_validation(self):
        """Test IMO checksum validation"""
        # Valid IMO
        self.assertTrue(validate_imo("9543212"))

        # Invalid IMO (wrong checksum)
        self.assertFalse(validate_imo("1234567"))

        # Invalid format
        self.assertFalse(validate_imo("12345"))
        self.assertFalse(validate_imo("ABC1234"))

    def test_pattern_extraction_fallback(self):
        """Test pattern-based extraction as fallback"""
        test_text = "Contact vessel at MMSI:366123456 or IMO#7654321"

        processor = NERPostprocessor()
        entities = processor._enhance_entities([], test_text)

        # Should extract MMSI and IMO via patterns
        mmsi_found = any(
            e["label"] == "MMSI" and "366123456" in e["text"]
            for e in entities
        )
        imo_found = any(
            e["label"] == "IMO" and "7654321" in e["text"]
            for e in entities
        )

        self.assertTrue(mmsi_found, "Should extract MMSI via pattern")
        self.assertTrue(imo_found, "Should extract IMO via pattern")

    def test_conflict_resolution(self):
        """Test overlapping entity resolution"""
        entities = [
            {"text": "OCEAN STAR", "label": "VESSEL_NAME", "start": 0, "end": 10, "confidence": 0.9},
            {"text": "OCEAN", "label": "VESSEL", "start": 0, "end": 5, "confidence": 0.7},
            {"text": "STAR", "label": "VESSEL", "start": 6, "end": 10, "confidence": 0.6},
        ]

        resolved = self.postprocessor._resolve_conflicts(entities)

        # Should keep highest confidence non-overlapping
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0]["label"], "VESSEL_NAME")

    def test_multi_label_entities(self):
        """Test entities with multiple valid labels"""
        test_text = "Captain John Smith of Blue Ocean Shipping operates the vessel"

        # Create entity with context
        entities = [{
            "text": "John Smith",
            "label": "PERSON",
            "confidence": 0.9,
            "context": test_text
        }]

        enhanced = self.postprocessor._handle_multi_label_entities(entities)

        # Should have both PERSON and VESSEL_MASTER
        labels = [e["label"] for e in enhanced]
        self.assertIn("PERSON", labels)
        self.assertIn("VESSEL_MASTER", labels)

    def test_regression_suite(self):
        """Run full regression test suite"""
        overall_results = []

        for fixture in self.fixtures[:10]:  # Test first 10 fixtures
            entities = self.postprocessor._enhance_entities([], fixture["text"])

            metrics = self.metrics.evaluate_entities(
                entities,
                fixture["expected_entities"],
                overlap_threshold=0.5
            )

            overall_results.append({
                "fixture_id": fixture["id"],
                "f1": metrics["overall"]["f1"],
                "precision": metrics["overall"]["precision"],
                "recall": metrics["overall"]["recall"]
            })

        # Calculate average performance
        avg_f1 = np.mean([r["f1"] for r in overall_results])
        avg_precision = np.mean([r["precision"] for r in overall_results])
        avg_recall = np.mean([r["recall"] for r in overall_results])

        print(f"\nRegression Test Results:")
        print(f"Average F1: {avg_f1:.3f}")
        print(f"Average Precision: {avg_precision:.3f}")
        print(f"Average Recall: {avg_recall:.3f}")

        # Set minimum acceptable thresholds
        self.assertGreater(avg_f1, 0.5, "Overall F1 below threshold")
        self.assertGreater(avg_precision, 0.5, "Overall precision below threshold")
        self.assertGreater(avg_recall, 0.4, "Overall recall below threshold")


def run_evaluation_report():
    """Generate detailed evaluation report"""
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "ebisu_ner_test_fixtures.json")
    with open(fixture_path, "r") as f:
        fixtures = json.load(f)["test_fixtures"]

    processor = NERPostprocessor()
    metrics_calc = NERMetrics()

    detailed_results = []

    for fixture in fixtures:
        entities = processor._enhance_entities([], fixture["text"])
        metrics = metrics_calc.evaluate_entities(
            entities,
            fixture["expected_entities"]
        )

        detailed_results.append({
            "fixture_id": fixture["id"],
            "text_preview": fixture["text"][:50] + "...",
            "metrics": metrics
        })

    # Generate report
    report = {
        "total_fixtures": len(fixtures),
        "results": detailed_results,
        "summary": {
            "avg_f1": np.mean([r["metrics"]["overall"]["f1"] for r in detailed_results]),
            "avg_precision": np.mean([r["metrics"]["overall"]["precision"] for r in detailed_results]),
            "avg_recall": np.mean([r["metrics"]["overall"]["recall"] for r in detailed_results])
        }
    }

    with open("ner_evaluation_report.json", "w") as f:
        json.dump(report, f, indent=2)

    print(f"Evaluation report saved to ner_evaluation_report.json")
    print(f"Summary: F1={report['summary']['avg_f1']:.3f}, "
          f"P={report['summary']['avg_precision']:.3f}, "
          f"R={report['summary']['avg_recall']:.3f}")


if __name__ == "__main__":
    # Run tests
    unittest.main(argv=[''], exit=False, verbosity=2)

    # Generate evaluation report
    print("\n" + "="*50)
    print("Generating Evaluation Report...")
    print("="*50)
    run_evaluation_report()
