'use client'

import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { SpecFrame } from '@/components/spec/spec-frame'
import styles from '../detail.module.css'

export default function ProfileEditPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [initial, setInitial] = useState('?')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((me) => {
        const n = me?.user?.displayName ?? ''
        setName(n)
        setEmail(me?.user?.email ?? '')
        setInitial((n || '?').trim().slice(0, 1))
      })
      .catch(() => {})
  }, [])

  async function save() {
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim() }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(data?.error || '저장하지 못했어요.')
      } else {
        setSaved(true)
        setInitial((name || '?').trim().slice(0, 1))
      }
    } catch {
      setError('저장 중 문제가 생겼어요.')
    }
    setBusy(false)
  }

  return (
    <SpecFrame backHref='/mypage' title='프로필 편집'>
      <div className={styles.body}>
        <div className={styles.avatarLg}>
          {initial}
          <button type='button' className={styles.avatarCam} title='프로필 사진 업로드 (준비 중)' aria-label='프로필 사진 업로드'>
            <Camera className='size-4' />
          </button>
        </div>
        <div className={styles.avatarHint}>탭해서 프로필 사진 변경</div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>닉네임</div>
          <input className={styles.fieldInput} value={name} onChange={(e) => setName(e.target.value)} placeholder='닉네임' />
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>이메일</div>
          <div className={styles.fieldFixed}>{email || '—'}</div>
          <div className={styles.fieldNote}>로그인 이메일은 변경할 수 없어요</div>
        </div>

        <button className={styles.saveBtn} onClick={save} disabled={busy || !name.trim()}>
          {busy ? '저장 중...' : '저장하기'}
        </button>
        {saved ? <div className={styles.savedNote}>저장되었어요.</div> : null}
        {error ? <div className={styles.errorNote}>{error}</div> : null}
      </div>
    </SpecFrame>
  )
}
