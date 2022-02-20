import { Collections, VideoTypes } from 'constants';

import { db, HttpsError, logger } from 'utils/firebase';
import { freezeChannel } from 'utils/sendbird';
import { Data, Video } from 'utils/mux';
import scheduleTask from 'utils/scheduleTask';

class NoAssetsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoAssetsError';
  }
}

export async function streamCompleteInternal(streamDocId) {
  const liveStreamDocSnap = await db
    .collection(Collections.liveStreams)
    .doc(streamDocId)
    .get();
  const { liveStreamId, assets, status } = liveStreamDocSnap.data();
  if (status === VideoTypes.finished) return;

  try {
    await freezeChannel(streamDocId);
  } catch (e) {
    logger.log(`Error freezing channelURL ${streamDocId}`, e);
  }

  if (!assets || !assets.length) throw new NoAssetsError('no assets');

  try {
    await Video.LiveStreams.disable(liveStreamId);
    await Video.LiveStreams.signalComplete(liveStreamId);
  } catch (e) {
    logger.log(`Error finalizing stream. Mux liveStreamId: ${liveStreamId}; streamDocId: ${streamDocId}`, e);
  }

  await liveStreamDocSnap.ref.update({ status: VideoTypes.finished });

  try {
    const { data } = await Data.Metrics.overall('unique_viewers', {
      filters: [`video_id:${streamDocId}`],
    });

    await liveStreamDocSnap.ref.update({ totalViews: data.total_views, uniqueViewers: data.value });
  } catch (e) {
    console.log(`Error getting views for livestream ${streamDocId}`, e);
  }

  // TODO:: to be enabled later
  try {
    const task = {
      queue: 'ls-reports',
      functionName: 'postLiveStreamTask',
      data: { streamDocId },
      // runAfter: 65 * 60,
      runAfter: 0,
    };
    await scheduleTask(task);
  } catch (e) {
    logger.log('failed to add the cloud task to the queue', e);
  }
}

export default async function streamComplete(data, context = null) {
  // const auth = context.auth || null;
  // if (!auth) throw new HttpsError('permission-denied', 'Not authenticated');

  const { streamDocId } = data;

  try {
    await streamCompleteInternal(streamDocId);
  } catch (error) {
    if (error instanceof NoAssetsError) throw new HttpsError('failed-precondition', error);
    throw new HttpsError('internal', error);
  }
}
