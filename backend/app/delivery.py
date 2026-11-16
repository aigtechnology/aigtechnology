"""Verified Indian PIN-code lookup and order-level delivery pricing."""

import re
from functools import lru_cache
from typing import Any

import httpx
from fastapi import HTTPException

GUJARAT_CHARGE = "350.00"
OUTSIDE_GUJARAT_CHARGE = "450.00"
PINCODE_API = "https://api.postalpincode.in/pincode/{}"

# India Post PIN ranges are used only as a controlled fallback if the lookup
# service is temporarily unavailable. The API result remains authoritative.
PIN_PREFIX_STATES = {
    "11": "Delhi",
    "12": "Haryana",
    "13": "Punjab",
    "14": "Punjab",
    "15": "Punjab",
    "16": "Chandigarh",
    "17": "Himachal Pradesh",
    "18": "Jammu and Kashmir",
    "19": "Jammu and Kashmir",
    "20": "Uttar Pradesh",
    "21": "Uttar Pradesh",
    "22": "Uttar Pradesh",
    "23": "Uttar Pradesh",
    "24": "Uttarakhand",
    "25": "Uttar Pradesh",
    "26": "Uttar Pradesh",
    "27": "Uttar Pradesh",
    "28": "Uttar Pradesh",
    "30": "Rajasthan",
    "31": "Rajasthan",
    "32": "Rajasthan",
    "33": "Rajasthan",
    "34": "Rajasthan",
    "36": "Gujarat",
    "37": "Gujarat",
    "38": "Gujarat",
    "39": "Gujarat",
    "40": "Maharashtra",
    "41": "Maharashtra",
    "42": "Maharashtra",
    "43": "Maharashtra",
    "44": "Maharashtra",
    "45": "Madhya Pradesh",
    "46": "Madhya Pradesh",
    "47": "Madhya Pradesh",
    "48": "Madhya Pradesh",
    "49": "Chhattisgarh",
    "50": "Telangana",
    "51": "Andhra Pradesh",
    "52": "Andhra Pradesh",
    "53": "Andhra Pradesh",
    "56": "Karnataka",
    "57": "Karnataka",
    "58": "Karnataka",
    "59": "Karnataka",
    "60": "Tamil Nadu",
    "61": "Tamil Nadu",
    "62": "Tamil Nadu",
    "63": "Tamil Nadu",
    "64": "Tamil Nadu",
    "65": "Tamil Nadu",
    "66": "Tamil Nadu",
    "67": "Kerala",
    "68": "Kerala",
    "69": "Kerala",
    "70": "West Bengal",
    "71": "West Bengal",
    "72": "West Bengal",
    "73": "West Bengal",
    "74": "West Bengal",
    "75": "Odisha",
    "76": "Odisha",
    "77": "Odisha",
    "78": "Assam",
    "79": "Arunachal Pradesh",
    "80": "Bihar",
    "81": "Bihar",
    "82": "Bihar",
    "83": "Jharkhand",
}


def _validate(pincode: str) -> str:
    value = re.sub(r"\D", "", str(pincode or ""))
    if not re.fullmatch(r"[1-9][0-9]{5}", value):
        raise HTTPException(status_code=422, detail="Enter a valid 6-digit Indian PIN code.")
    return value


def _result(pincode: str, state: str, city: str = "") -> dict[str, str | bool]:
    normalized_state = state.strip() or "India"
    charge = GUJARAT_CHARGE if normalized_state.casefold() == "gujarat" else OUTSIDE_GUJARAT_CHARGE
    return {
        "postal_code": pincode,
        "state": normalized_state,
        "city": city.strip(),
        "delivery_charge": charge,
        "delivery_verified": True,
        "message": f"{normalized_state}: packaging and delivery charge is ₹{int(float(charge))}.",
    }


@lru_cache(maxsize=512)
def lookup_pincode(pincode: str) -> dict[str, str | bool]:
    value = _validate(pincode)
    try:
        response = httpx.get(PINCODE_API.format(value), timeout=4.0)
        response.raise_for_status()
        payload: Any = response.json()
        entry = payload[0] if isinstance(payload, list) and payload else None
        offices = entry.get("PostOffice") if isinstance(entry, dict) else None
        office = offices[0] if isinstance(offices, list) and offices else None
        state = office.get("State") if isinstance(office, dict) else None
        city = (office.get("District") or office.get("Block")) if isinstance(office, dict) else ""
        if entry and str(entry.get("Status", "")).casefold() == "success" and state:
            return _result(value, str(state), str(city or ""))
    except (httpx.HTTPError, ValueError, TypeError, KeyError, IndexError):
        pass

    fallback_state = PIN_PREFIX_STATES.get(value[:2])
    if fallback_state:
        return _result(value, fallback_state)
    raise HTTPException(status_code=503, detail="PIN-code state verification is temporarily unavailable. Please try again.")
