import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useBlobUrl } from '../photos'

export default function Thumb({ photoId, className = 'list-thumb' }: { photoId?: string; className?: string }) {
  const photo = useLiveQuery(() => (photoId ? db.photos.get(photoId) : undefined), [photoId])
  const url = useBlobUrl(photo?.thumb)
  return <div className={className}>{url && <img src={url} alt="" />}</div>
}
