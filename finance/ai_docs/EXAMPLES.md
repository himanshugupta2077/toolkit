# Few-shot examples (voice → JSON)

## 1. Simple UPI spend

**Input:** "I just bought a card 50 rupees"

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
      "notes": "card",
      "date": null,
      "time": null
    }
  ],
  "confidence": "medium",
  "raw_summary": "₹50 spend for a card (method unspecified)"
}
```

## 2. Food delivery

**Input:** "Swiggy 340 on HDFC card"

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
      "notes": "Swiggy",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹340 Swiggy on HDFC Credit Card"
}
```

## 3. Petrol cash

**Input:** "petrol 500 cash"

```json
{
  "entries": [
    {
      "amount": 500,
      "type": "Expense",
      "category": "Petrol",
      "from_account": "Cash",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "petrol",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹500 petrol paid cash"
}
```

## 4. CC bill payment

**Input:** "paid ICICI credit card bill 12000 from HDFC"

```json
{
  "entries": [
    {
      "amount": 12000,
      "type": "Credit Card Payment",
      "category": "Credit Card Bill",
      "from_account": "HDFC Savings",
      "to_account": "ICICI Credit Card",
      "include_in_budget": false,
      "notes": "ICICI CC bill",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹12000 CC payment HDFC Savings → ICICI Credit Card"
}
```

## 5. Salary

**Input:** "salary credited 83000"

```json
{
  "entries": [
    {
      "amount": 83000,
      "type": "Income",
      "category": "Salary",
      "from_account": "Employer",
      "to_account": "HDFC Savings",
      "include_in_budget": false,
      "notes": "salary",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹83000 salary to HDFC Savings"
}
```

## 6. Transfer

**Input:** "transferred 2000 from HDFC to ICICI"

```json
{
  "entries": [
    {
      "amount": 2000,
      "type": "Transfer",
      "category": "Transfer",
      "from_account": "HDFC Savings",
      "to_account": "ICICI Savings",
      "include_in_budget": false,
      "notes": "",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹2000 transfer HDFC → ICICI"
}
```

## 7. Two items

**Input:** "dosa 80 and chaas 20"

```json
{
  "entries": [
    {
      "amount": 80,
      "type": "Expense",
      "category": "Eating outside",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "dosa",
      "date": null,
      "time": null
    },
    {
      "amount": 20,
      "type": "Expense",
      "category": "Cafe / Snacks",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "chaas",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹80 dosa + ₹20 chaas"
}
```

## 8. Not a transaction

**Input:** "remind me to check the dashboard later"

```json
{
  "entries": [],
  "confidence": "low",
  "raw_summary": "no transaction found",
  "error": "Speech is not a money transaction"
}
```
