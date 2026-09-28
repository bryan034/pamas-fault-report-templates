from app.models import ReportData


def test_new_report_defaults_are_blank() -> None:
    report = ReportData()
    assert report.report_number == ""
    assert report.company == ""
    assert report.repair_priority is None
    assert report.emissivity is None
    assert report.bx1 is None


def test_delta_temperature_is_computed() -> None:
    report = ReportData(bx1=66.1, bx2=53.0)
    assert report.delta_t == 13.1


def test_missing_temperature_has_no_delta() -> None:
    report = ReportData(bx1=None, bx2=53.0)
    assert report.delta_t is None


def test_single_digit_report_number_gets_leading_zero() -> None:
    assert ReportData(report_number="1").report_number == "01"
    assert ReportData(report_number="7").report_number == "07"
    assert ReportData(report_number="12").report_number == "12"
