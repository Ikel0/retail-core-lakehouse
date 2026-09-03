import unittest

from build_portfolio import build_static_payload


class PortfolioBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = build_static_payload()

    def test_all_filter_combinations_are_embedded(self):
        dashboards = self.payload["dashboards"]
        self.assertEqual(len(dashboards), 12)
        for dashboard in dashboards.values():
            self.assertEqual(dashboard["reconciliation"]["delta"], 0)
            self.assertEqual(dashboard["quality"]["status"], "PASS")
            self.assertEqual(
                sum(item["selected_units_sold"] for item in dashboard["inventory"]),
                dashboard["kpis"]["units"],
            )

    def test_all_capacity_steps_are_embedded(self):
        simulations = self.payload["simulations"]
        self.assertEqual(len(simulations), 21)
        self.assertEqual(simulations["5.0"]["simulated_rps"], 210)
        self.assertEqual(simulations["5.0"]["reconciliation_delta"], 0)


if __name__ == "__main__":
    unittest.main()
