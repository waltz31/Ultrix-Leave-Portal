export function mapRating(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    employeeNumber: row.employee_number ?? null,
    managerId: row.manager_id,
    managerName: row.manager_name || 'Manager',
    score: row.score,
    feedback: row.feedback,
    periodLabel: row.period_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const RATING_SELECT = `
  SELECT er.*,
         emp.name AS user_name,
         emp.email AS user_email,
         emp.employee_number AS employee_number,
         mgr.name AS manager_name
  FROM employee_ratings er
  JOIN users emp ON emp.id = er.user_id
  LEFT JOIN users mgr ON mgr.id = er.manager_id
`;
