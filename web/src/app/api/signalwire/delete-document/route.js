import { getEmployeeById, updateEmployeeDocuments } from '@/lib/db';
import { requireAuth } from '@/app/api/middleware/auth';

export async function POST(request) {
  try {
    const body = await request.json();
    const { employeeId, documentId } = body;
    const bodyCredentials = body.credentials || {
      spaceUrl: body.spaceUrl,
      projectId: body.projectId,
      apiToken: body.apiToken,
    };

    if (!employeeId || !documentId) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Try session-based auth first, fall back to body credentials
    let creds = bodyCredentials;
    const auth = await requireAuth(request);
    if (!auth.error) {
      creds = { spaceUrl: auth.spaceUrl, projectId: auth.projectId, apiToken: auth.apiToken };
    } else if (!creds?.spaceUrl || !creds?.projectId || !creds?.apiToken) {
      return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { spaceUrl, projectId, apiToken } = creds;

    // Delete from DataSphere
    const spaceDomain = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const dsUrl = `https://${spaceDomain}/api/datasphere/documents/${documentId}`;
    const authHeader = 'Basic ' + Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    const dsResponse = await fetch(dsUrl, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader },
    });

    if (!dsResponse.ok && dsResponse.status !== 404) {
      const errText = await dsResponse.text();
      console.error('DataSphere delete failed:', dsResponse.status, errText);
      return Response.json({
        success: false,
        error: `DataSphere delete failed: ${dsResponse.status}`,
      }, { status: 502 });
    }

    // Remove from employee's documents array
    const employee = getEmployeeById(employeeId);
    if (!employee) {
      return Response.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    const documents = (employee.documents ? JSON.parse(employee.documents) : []).filter(d => d.document_id !== documentId);
    updateEmployeeDocuments(employeeId, documents);

    return Response.json({ success: true });
  } catch (error) {
    console.error('Delete document error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
