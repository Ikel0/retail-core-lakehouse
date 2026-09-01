import unittest

from serve import simulate_black_friday


class BusinessRulesTest(unittest.TestCase):
    def test_black_friday_simulation_preserves_reconciliation(self):
        result = simulate_black_friday(5)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reconciliation_delta"], 0)
        self.assertEqual(result["simulated_rps"], 210)
        self.assertGreater(result["shards_after"], result["shards_before"])

    def test_simulation_multiplier_is_capped(self):
        result = simulate_black_friday(99)
        self.assertEqual(result["multiplier"], 12)


if __name__ == "__main__":
    unittest.main()
