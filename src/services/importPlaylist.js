const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const { fetchPlaylistMeta, fetchPlaylistItems } = require('../utils/youtube');

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) : str;
}

async function importPlaylist(playlistId) {
  // Fetch playlist metadata and items from YouTube API
  const meta = await fetchPlaylistMeta(playlistId);
  const items = await fetchPlaylistItems(playlistId);

  const lectureCount = items.length;

  // Check if course already exists to determine created vs updated
  const existingCourse = await Course.findOne({ source: 'youtube', sourcePlaylistId: playlistId });
  const createdOrUpdated = existingCourse ? 'updated' : 'created';

  // Upsert Course by { source: 'youtube', sourcePlaylistId }
  const update = {
    title: meta.title,
    description: truncate(meta.description, 500),
    thumbnailUrl: meta.thumbnailUrl || '',
    isActive: true,
    source: 'youtube',
    sourcePlaylistId: playlistId,
    lectureCount,
  };
  const course = await Course.findOneAndUpdate(
    { source: 'youtube', sourcePlaylistId: playlistId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Upsert Lectures by { courseId, videoId }
  const currentVideoIds = [];
  for (const it of items) {
    const orderIndex = (it.position ?? 0) + 1;
    const videoId = it.videoId;
    currentVideoIds.push(videoId);

    await Lecture.updateOne(
      { courseId: course._id, videoId },
      {
        $set: {
          courseId: course._id,
          title: it.title || `Lecture ${orderIndex}`,
          videoId,
          orderIndex,
          isLocked: false,
        },
      },
      { upsert: true }
    );
  }

  // Prune lectures that no longer exist in the playlist
  await Lecture.deleteMany({
    courseId: course._id,
    videoId: { $nin: currentVideoIds },
  });

  // Return summary
  return {
    playlistId,
    courseId: course._id,
    courseTitle: course.title,
    createdOrUpdated,
    lectureCount,
  };
}

module.exports = { importPlaylist };
