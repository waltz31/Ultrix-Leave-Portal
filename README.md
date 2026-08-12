# Ultrix Leave Portal

Leave management with **Employee → Manager → HR** approval.

## Stack

- **Client:** React + Vite
- **API:** Node.js + Express
- **DB:** SQLite (`server/data/leave.db`)

## Roles & flow

1. Employee applies for leave or WFH  
2. Manager approves or rejects (balance not deducted yet)  
3. HR gives final approval (leave balance deducted) or rejects  
4. Progress is visible to employee, manager, and HR  

Employees can cancel pending or approved requests anytime (balance restored after final approval cancellation).

## Quick start

```bash
npm run install:all
npm run seed
npm run dev:server   # :4000
npm run dev:client   # :5173
```

### Demo logins

| Role     | Email                | Password    |
|----------|----------------------|-------------|
| Employee | ada@ultrix.com       | user123     |
| Manager  | manager@ultrix.com   | manager123  |
| HR       | hr@ultrix.co        | hr123       |
| HR (alt) | admin@ultrix.com     | admin123    |
