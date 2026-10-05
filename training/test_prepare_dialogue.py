import unittest

from training.prepare_dialogue import prepare


class PreparationTests(unittest.TestCase):
    def test_strips_secret_and_unanswered_final_turn(self):
        records = [{
            "scenario": {"id": "family-a", "recommended_technique": "secret clue"},
            "api_key_used": "should-never-appear",
            "transcript": [
                {"role": "client", "content": "I feel tired"},
                {"role": "responder", "content": "(softly) Would you like to rest?"},
                {"role": "client", "content": "Yes"},
            ],
        }]
        outputs, stats = prepare(records, "test")
        examples = [row for values in outputs.values() for row in values]
        self.assertEqual(len(examples), 1)
        self.assertEqual(stats["unanswered_final_turns_skipped"], 1)
        self.assertEqual(stats["secret_bearing_records_omitted_from_output"], 1)
        self.assertNotIn("should-never-appear", str(examples))
        self.assertNotIn("secret clue", str(examples))
        self.assertNotIn("softly", str(examples))

    def test_family_assignment_is_stable(self):
        record = {"metadata": {"family": "f1"}, "messages": [
            {"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"},
        ]}
        outputs, stats = prepare([record, record], "same")
        self.assertEqual(sum(map(len, outputs.values())), 2)
        self.assertEqual(stats["families"], 1)
        self.assertEqual(sum(bool(rows) for rows in outputs.values()), 1)


if __name__ == "__main__":
    unittest.main()
