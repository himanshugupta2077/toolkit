# Few-shot examples (text / speech → Finance OS JSON)

## 1. Groceries from savings

**Input:** "curd 20 rupee from savings"

```json
{
  "entries": [
    {
      "amount": 20,
      "type": "expense",
      "category": "Groceries",
      "from_account": "HDFC Savings",
      "to_account": "Expense",
      "include_in_budget": true,
      "notes": "curd",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹20 curd from savings"
}
```

## 2. Card spend

**Input:** "Swiggy 340 on HDFC card"

```json
{
  "entries": [
    {
      "amount": 340,
      "type": "expense",
      "category": "Eating outside",
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

## 3. Cash petrol

**Input:** "petrol 500 cash"

```json
{
  "entries": [
    {
      "amount": 500,
      "type": "expense",
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

## 4. CC bill

**Input:** "paid HDFC credit card bill 12000 from savings"

```json
{
  "entries": [
    {
      "amount": 12000,
      "type": "cc_payment",
      "category": "Credit Card Bill",
      "from_account": "HDFC Savings",
      "to_account": "HDFC Credit Card",
      "include_in_budget": false,
      "notes": "HDFC credit card bill",
      "date": null,
      "time": null
    }
  ],
  "confidence": "high",
  "raw_summary": "₹12,000 CC payment from savings"
}
```

## 5. Salary

**Input:** "salary 140000 credited to HDFC"

```json
{
  "entries": [
    {
      "amount": 140000,
      "type": "income",
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
  "raw_summary": "₹1,40,000 salary to HDFC Savings"
}
```

If a named category or account is missing from the allowed lists, pick the closest allowed name instead of inventing a new one.
