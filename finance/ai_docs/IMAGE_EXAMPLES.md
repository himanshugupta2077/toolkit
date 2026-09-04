# Few-shot examples (screenshot + note → JSON)

## 1. UPI success + empty note

**Images:** GPay success — ₹50 to “Stationary Mart”, paid via HDFC  
**Note:** _(empty)_

```json
{
  "entries": [
    {
      "amount": 50,
      "type": "Expense",
      "category": "Other",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Stationary Mart",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹50 UPI to Stationary Mart"
}
```

## 2. Swiggy bill + voice note

**Images:** Swiggy order — chicken biryani, coke — total ₹340  
**Note:** "HDFC card"

```json
{
  "entries": [
    {
      "amount": 340,
      "type": "Expense",
      "category": "Food delivery",
      "from_account": "HDFC Credit Card",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Swiggy: chicken biryani, coke",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹340 Swiggy on HDFC Credit Card"
}
```

## 3. Blinkit order summary (no user note)

**Images:** Blinkit bill total ₹342 — Tender Coconut, Banana, Carrot, Pumpkin, ORS, Potato  
**Note:** _(empty)_

```json
{
  "entries": [
    {
      "amount": 342,
      "type": "Expense",
      "category": "Groceries - Online",
      "from_account": "HDFC Credit Card",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Blinkit: tender coconut, banana, carrot, pumpkin, ORS, potato",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹342 Blinkit groceries on card"
}
```

## 4. Two photos, one petrol fill

**Images:** pump display ₹1500 + UPI paid screen  
**Note:** "cash actually, ignore UPI on screen"

```json
{
  "entries": [
    {
      "amount": 1500,
      "type": "Expense",
      "category": "Petrol",
      "from_account": "Cash",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Petrol",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹1500 petrol cash (user corrected payment method)"
}
```

## 5. Unreadable receipt, note has the facts

**Images:** blurry photo  
**Note:** "cafe 180 hdfc upi"

```json
{
  "entries": [
    {
      "amount": 180,
      "type": "Expense",
      "category": "Cafe / Snacks",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "Cafe",
      "date": null,
      "time": null
    }
  ],
  "confidence": "medium",
  "raw_summary": "₹180 cafe HDFC UPI from note (image unclear)"
}
```
