/**
 * Assign Phone Number to Employee
 *
 * POST: Creates a phone route in SignalWire linking a number to an employee's resource
 * DELETE: Removes the phone route assignment
 */

import { requireAuth } from '@/app/api/middleware/auth';
import { getEmployeeById, getDb } from '@/lib/db';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { employeeId, phoneNumber } = await request.json();

    if (!employeeId || !phoneNumber) {
      return Response.json(
        { error: 'Missing employeeId or phoneNumber' },
        { status: 400 }
      );
    }

    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    if (!employee.resource_id) {
      return Response.json(
        { error: 'Employee has no SignalWire resource — create the employee first' },
        { status: 400 }
      );
    }

    const { spaceUrl, projectId, apiToken } = auth;
    const baseUrl = `https://${spaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    // Check if number is already assigned to another employee
    const db = getDb();
    const existing = db.prepare(
      'SELECT id, name FROM employees WHERE phone_number = ? AND id != ? AND status = ?'
    ).get(phoneNumber, employeeId, 'active');

    if (existing) {
      return Response.json(
        {
          error: `Phone number already assigned to "${existing.name}"`,
          existingEmployeeId: existing.id,
        },
        { status: 409 }
      );
    }

    // Create phone route in SignalWire Fabric
    console.log(`[Assign Phone] Creating phone route for ${phoneNumber} -> resource ${employee.resource_id}`);

    const routeResponse = await fetch(
      `${baseUrl}/api/fabric/resources/${employee.resource_id}/phone_routes`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
        }),
      }
    );

    if (!routeResponse.ok) {
      const errorText = await routeResponse.text();
      console.error('[Assign Phone] Failed to create phone route:', routeResponse.status, errorText);
      return Response.json(
        { error: 'Failed to create phone route: ' + errorText },
        { status: routeResponse.status }
      );
    }

    const routeData = await routeResponse.json();

    // Update employee in database
    db.prepare(
      'UPDATE employees SET phone_number = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(phoneNumber, employeeId);

    console.log(`[Assign Phone] Phone number ${phoneNumber} assigned to ${employee.name} (${employeeId})`);

    return Response.json({
      success: true,
      phoneNumber,
      employeeId,
      routeId: routeData.id,
      message: `Phone number ${phoneNumber} assigned to ${employee.name}`,
    });
  } catch (error) {
    console.error('[Assign Phone] Error:', error);
    return Response.json(
      { error: 'Failed to assign phone number: ' + error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const { employeeId } = await request.json();

    if (!employeeId) {
      return Response.json({ error: 'Missing employeeId' }, { status: 400 });
    }

    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }

    if (!employee.phone_number) {
      return Response.json({ error: 'No phone number assigned' }, { status: 400 });
    }

    const { spaceUrl, projectId, apiToken } = auth;
    const baseUrl = `https://${spaceUrl}`;
    const basicAuth = Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    // List phone routes to find the one to delete
    if (employee.resource_id) {
      try {
        const listRes = await fetch(
          `${baseUrl}/api/fabric/resources/${employee.resource_id}/phone_routes`,
          {
            headers: { 'Authorization': `Basic ${basicAuth}` },
          }
        );

        if (listRes.ok) {
          const routes = await listRes.json();
          const matchingRoute = (routes.data || []).find(
            (r) => r.phone_number === employee.phone_number
          );

          if (matchingRoute) {
            await fetch(
              `${baseUrl}/api/fabric/resources/${employee.resource_id}/phone_routes/${matchingRoute.id}`,
              {
                method: 'DELETE',
                headers: { 'Authorization': `Basic ${basicAuth}` },
              }
            );
            console.log(`[Unassign Phone] Deleted phone route ${matchingRoute.id}`);
          }
        }
      } catch (err) {
        console.warn('[Unassign Phone] Could not delete phone route:', err.message);
      }
    }

    // Clear phone number from database
    const db = getDb();
    db.prepare(
      'UPDATE employees SET phone_number = \'\', updated_at = datetime(\'now\') WHERE id = ?'
    ).run(employeeId);

    console.log(`[Unassign Phone] Phone number unassigned from ${employee.name} (${employeeId})`);

    return Response.json({
      success: true,
      message: `Phone number unassigned from ${employee.name}`,
    });
  } catch (error) {
    console.error('[Unassign Phone] Error:', error);
    return Response.json(
      { error: 'Failed to unassign phone number: ' + error.message },
      { status: 500 }
    );
  }
}
