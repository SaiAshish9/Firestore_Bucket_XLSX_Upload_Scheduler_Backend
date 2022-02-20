import admin from 'firebase-admin';
import { CloudTasksClient } from '@google-cloud/tasks';

const project = admin.instanceId().app.options.projectId;
const location = 'europe-west1';

const tasksClient = new CloudTasksClient();

/**
 * @param queue { string } queue name
 * @param data
 * @param functionName { string }
 * @param runAfter { number } duration in seconds
 * @return { Promise<void> }
 */
export default async function scheduleTask({ queue, data, functionName, runAfter }) {
  const queuePath = tasksClient.queuePath(project, location, queue);

  const url = `https://${location}-${project}.cloudfunctions.net/${functionName}`;

  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url,
      body: Buffer.from(JSON.stringify({ data })).toString('base64'),
      headers: {
        'Content-Type': 'application/json',
      },
    },
    scheduleTime: {
      seconds: Math.ceil(Date.now() / 1000) + runAfter,
    },
  };

  await tasksClient.createTask({ parent: queuePath, task });
}
