# Torn API Patterns & DOM Selectors Reference

## Torn API Overview

- **Base URL:** `https://api.torn.com/`
- **V1 format:** `https://api.torn.com/{type}/{id}?selections={selections}&key={key}`
- **V2 format:** Has Swagger docs at `https://www.torn.com/swagger/index.html`, uses `Authorization: ApiKey {key}` header
- **Rate limit:** 100 requests per minute per user across all keys
- **Key access levels:** Public, Minimal, Limited, Full

---

## V1 API Response Formats

### User Selections

#### `bars`

Returns energy/nerve/happy/life at top level:

```json
{
  "energy": { "current": 150, "maximum": 150, "increment": 5, "interval": 600, "ticktime": 480, "fulltime": 0 },
  "nerve": { "current": 55, "maximum": 55, "increment": 1, "interval": 300, "ticktime": 60, "fulltime": 0 },
  "happy": { "current": 3500, "maximum": 5000, "increment": 5, "interval": 900, "ticktime": 300, "fulltime": 270000 },
  "life": { "current": 7500, "maximum": 7500, "increment": 135, "interval": 300, "ticktime": 180, "fulltime": 0 },
  "chain": { "current": 0, "timeout": 0 }
}
```

#### `cooldowns`

```json
{
  "cooldowns": { "drug": 0, "booster": 0, "medical": 0 }
}
```

#### `battlestats`

Returns plain numbers at top level in V1:

```json
{
  "strength": 12345678,
  "speed": 12345678,
  "dexterity": 12345678,
  "defense": 12345678,
  "strength_modifier": 0,
  "defense_modifier": 0,
  "speed_modifier": 0,
  "dexterity_modifier": 0,
  "strength_info": [],
  "defense_info": [],
  "speed_info": [],
  "dexterity_info": []
}
```

#### `money`

```json
{
  "points": 5000,
  "cayman_bank": 0,
  "vault_amount": 0,
  "company_funds": 0,
  "daily_networth": 50000000,
  "money_onhand": 1000000,
  "city_bank": { "amount": 0, "time_left": 0 }
}
```

#### `profile`

Complex object with life data, status, etc.

```json
{
  "rank": "Lordly",
  "level": 75,
  "player_id": 12345,
  "name": "PlayerName",
  "life": { "current": 7500, "maximum": 7500 },
  "status": { "description": "Okay", "details": "", "state": "Okay", "color": "green", "until": 0 },
  "last_action": { "timestamp": 1234567890, "status": "Online", "relative": "2 minutes ago" }
}
```

#### `stocks`

Returns object keyed by stock ID.

### Faction Selections

#### `basic`

Faction info, members, wars data.

#### `attacks`

Attack history used for retal monitoring.

---

## V2 API Differences

Note that V2 uses different field structures:

- **battlestats:** `{ strength: { value: X }, speed: { value: X }, ... }` (objects with `.value` instead of plain numbers)
- **money:** `{ wallet: X, city_bank: { until: X } }` (`wallet` instead of `money_onhand`)
- **profile:** `{ profile: { life: { current, maximum }, status: {...}, ... } }` (nested under `profile` key)

### V2 Market Endpoint (bazaar & itemmarket)

As of early 2025, the `bazaar` and `itemmarket` selections on the `market` endpoint are **v2-only** (error code 23 on v1).

**V1 (no longer works for bazaar/itemmarket):**
```
GET https://api.torn.com/market/{itemId}?selections=bazaar,itemmarket&key={key}
→ { "bazaar": [{ "cost": 12345, "quantity": 1 }, ...], "itemmarket": [{ "cost": 12345, "quantity": 1 }, ...] }
```

**V2 (current):**
```
GET https://api.torn.com/v2/market/{itemId}?selections=bazaar,itemmarket&key={key}
→ { "bazaar": { "listings": [{ "price": 12345, "quantity": 1 }, ...] }, "itemmarket": { "listings": [{ "price": 12345, "quantity": 1 }, ...] } }
```

**Key differences:**
- URL base changes from `api.torn.com/` to `api.torn.com/v2/`
- Response wraps arrays in `{ listings: [...] }` objects
- Field name changes from `.cost` to `.price`
- V2 also supports header auth: `Authorization: ApiKey {key}` (query param `?key=` still works)

**Error code 23** = "This selection is only available in API v2" — signals that a selection has been migrated and the v1 endpoint no longer serves it.

### V2 Migration Checklist

When migrating a script from v1 to v2:
1. Change URL: `api.torn.com/{section}` → `api.torn.com/v2/{section}`
2. Check response structure — arrays may be wrapped in `{ listings: [...] }` or nested under new keys
3. Check field names — `cost` → `price`, `money_onhand` → `wallet`, etc.
4. Test defensively: `Array.isArray(data.field) ? data.field : data.field?.listings || []`
5. Normalize field names: `e.price ?? e.cost` to support both formats during transition

---

## Common API Patterns from Community Scripts

### Fetch Interception (TornTools pattern)

Hook `window.fetch` and `XMLHttpRequest` to intercept API responses made by the Torn website itself. This lets scripts get data without making their own API calls.

### TornW3B — Third-Party Bazaar Prices

The Torn API v2 `bazaar` selection returns a bazaar *directory* (store names/stats), NOT per-item price listings. To get bazaar floor prices for specific items, use the **TornW3B** service (same approach used by TornTools):

```
GET https://weav3r.dev/api/marketplace/{itemId}
```

Response:
```json
{
  "item_id": 186,
  "item_name": "Sheep Plushie",
  "market_price": 600,
  "bazaar_average": 599,
  "total_listings": 840,
  "listings": [
    { "item_id": 186, "player_id": 123, "player_name": "Someone", "quantity": 2, "price": 579, "content_updated": 1773911313, "last_checked": 1773911313 },
    ...
  ]
}
```

- **No API key required**
- Listings sorted by price ascending (first = cheapest)
- `bazaar_average` is the average across all bazaar listings
- `content_updated` / `last_checked` are Unix timestamps

### API Key Sources

1. **Torn PDA injection:** `###PDA-APIKEY###` placeholder replaced at runtime
2. **Manual entry:** User provides key in UI, stored in `localStorage`
3. **URL extraction:** Parse API key from intercepted API call URLs

### GM_xmlhttpRequest (Tampermonkey pattern)

For cross-origin API calls from userscripts:

```javascript
GM_xmlhttpRequest({
  method: 'GET',
  url: `https://api.torn.com/user/?selections=bars&key=${apiKey}`,
  onload: function(response) {
    const data = JSON.parse(response.responseText);
  }
});
```

### Internal Torn Endpoints

- **Inventory:** `fetch('/inventory.php?rfcv=' + unsafeWindow.getRFC(), ...)`
- **Market:** `/imarket.php`, `/bazaar.php`
- These use Torn's internal RFCV (CSRF) token

---

## Real Torn DOM Selectors

### Item Market

| Element | Selector |
|---|---|
| Item list container | `[class*='itemList___'] > li` |
| Item price | `[class*='priceAndTotal___'] span:first-child` |
| Market search | `[class*='searchBar___']` |

### Faction Page

| Element | Selector |
|---|---|
| Members list | `.members-list .table-body > li` |
| War info | `.faction-war`, `[class*='warStatus___']` |

### Profile / Status

| Element | Selector |
|---|---|
| Drug cooldown | `[aria-label^='Drug Cooldown:']` |
| Booster cooldown | `[aria-label^='Booster Cooldown:']` |
| Medical cooldown | `[aria-label^='Medical Cooldown:']` |

### General

| Element | Selector |
|---|---|
| Page loading skeleton | `.react-loading-skeleton` |
| Chat root | `#chatRoot` |
| Content wrapper | `.content-wrapper[role="main"]` |
| Header | `[class*='header___']` |

### Navigation

| Element | Selector |
|---|---|
| Sidebar links | `[class*='menuItem___']`, `.sidebar [class*='link___']` |
| Area links | `.area-desktop___`, `[class*='area___']` |

---

## Key Development Patterns

### `requireElement()` Pattern (from TornTools)

Promise-based polling for dynamic DOM elements:

```javascript
function requireElement(selector, options = {}) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const maxCount = options.maxCycles || 1000;
    const interval = options.interval || 50;
    const check = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (++count >= maxCount) return reject(new Error('Element not found: ' + selector));
      setTimeout(check, interval);
    };
    check();
  });
}
```

### Countdown Timer Pattern

Use absolute timestamps (`dataset.end = Date.now() + seconds * 1000`) instead of relative seconds to prevent desync when tab is inactive.

### Anti-scrape Protection

Only fire sensitive events when tab is focused:

```javascript
function isTabFocused() { return !document.hidden; }
```

### Feature Registration Pattern (TornTools)

```javascript
featureManager.registerFeature(name, scope, enabled, init, execute, cleanup, storage, requirements, options)
```

### Virtual Scroll Handling

Torn uses virtualized lists. To access all items, programmatically scroll to force rendering of off-screen elements.

---

## Error Codes

| Code | Description |
|---:|---|
| 0 | Unknown error |
| 1 | Key is empty |
| 2 | Incorrect Key |
| 3 | Wrong type |
| 4 | Wrong fields (invalid selection) |
| 5 | Too many requests (rate limited) |
| 6 | Incorrect ID |
| 7 | Incorrect ID-entity relation (private data) |
| 8 | IP block |
| 9 | API disabled |
| 10 | Key owner in federal jail |
| 13 | Key disabled due to owner inactivity (7+ days offline) |
| 16 | Key access level too low |
| 17 | Backend error |
| 18 | API key paused by owner |
