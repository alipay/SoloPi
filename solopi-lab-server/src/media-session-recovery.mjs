// A source which never joined cannot be reused after its client ticket expires.
// Recover only pending capture sources; never terminate an established stream.
export function reapExpiredPendingMedia(db,at=Date.now()){
 const stale=db.prepare(`SELECT ms.id,ms.media_session_ulid FROM media_session ms
 WHERE ms.status='authorized' AND ms.source_session_ulid IS NULL AND ms.viewer_subject_ref IS NULL
 AND NOT EXISTS(SELECT 1 FROM media_ticket t WHERE t.media_session_rowid=ms.id AND t.role='viewer')
 AND EXISTS(SELECT 1 FROM media_ticket t WHERE t.media_session_rowid=ms.id AND t.role='client')
 AND NOT EXISTS(SELECT 1 FROM media_ticket t WHERE t.media_session_rowid=ms.id AND t.role='client' AND t.revoked_at_ms IS NULL AND t.expires_at_ms>?)`).all(at);
 if(!stale.length)return 0;
 db.exec('BEGIN IMMEDIATE');
 try{for(const source of stale){
  const changed=db.prepare("UPDATE media_session SET status='failed',ended_reason='client-ticket-expired',ended_at_ms=? WHERE id=? AND status='authorized'").run(at,source.id);
  if(!changed.changes)continue;
  db.prepare("UPDATE media_session SET status='failed',ended_reason='source-unavailable',ended_at_ms=? WHERE source_session_ulid=? AND status IN ('authorized','live')").run(at,source.media_session_ulid);
  db.prepare('UPDATE media_ticket SET revoked_at_ms=? WHERE revoked_at_ms IS NULL AND media_session_rowid IN (SELECT id FROM media_session WHERE id=? OR source_session_ulid=?)').run(at,source.id,source.media_session_ulid);
 }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return stale.length;
}
