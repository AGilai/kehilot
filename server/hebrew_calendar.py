"""Offline Hebrew dates shared by profile validation, eligibility and aliyot."""
from datetime import date
import calendar
from pyluach import dates, hebrewcal

MONTH_NUMBERS = dict(nisan=1, iyar=2, sivan=3, tamuz=4, av=5, elul=6,
                     tishrei=7, cheshvan=8, kislev=9, tevet=10, shevat=11,
                     adar=12, adar_i=12, adar_ii=13)


def birth_date(value, today):
    if not isinstance(value, dict) or set(value) != {'day', 'month', 'year'}:
        raise ValueError('Select a Hebrew birth day, month and year.')
    day, month, year = value['day'], value['month'], value['year']
    if type(day) is not int or type(year) is not int or not isinstance(month, str):
        raise ValueError('Invalid Hebrew birthday.')
    current_year = dates.HebrewDate.from_pydate(today).year
    if not 5700 <= year <= current_year or month not in MONTH_NUMBERS:
        raise ValueError('Invalid Hebrew birth year or month.')
    leap = hebrewcal.Year(year).leap
    if (leap and month == 'adar') or (not leap and month in ('adar_i', 'adar_ii')):
        raise ValueError('This Adar does not exist in the selected year.')
    result = dates.HebrewDate(year, MONTH_NUMBERS[month], day)
    if result.to_pydate() > today:
        raise ValueError('Birthdays cannot be in the future.')
    return result


def bar_mitzvah_date(value, today):
    """Calendrical birthday convention: regular Adar -> Adar II in leap years;
    Adar I stays I when possible; a missing day 30 moves to the next day.
    No inference from the recorded ceremony/parasha or legacy Gregorian date.
    """
    try:
        return birth_date(value, today).add(years=13).to_pydate()
    except (ValueError, TypeError, KeyError):
        return None


def bat_mitzvah_date(value, today):
    """The 12th Hebrew birthday, with the same Adar and day-30 convention as bar_mitzvah_date."""
    try:
        return birth_date(value, today).add(years=12).to_pydate()
    except (ValueError, TypeError, KeyError):
        return None


def months_before(day, months):
    """Gregorian calendar months, clamping to the last day of a shorter month."""
    index = day.year * 12 + day.month - 1 - months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def hebrew_label(day):
    return dates.HebrewDate.from_pydate(day).hebrew_date_string()


def is_shabbat_or_festival(day):
    hebrew = dates.HebrewDate.from_pydate(day)
    return day.weekday() == 5 or hebrew.festival(israel=True, include_working_days=True) is not None
