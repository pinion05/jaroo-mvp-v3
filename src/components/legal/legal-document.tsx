import type { ReactNode } from 'react'
import { SpecFrame } from '@/components/spec/spec-frame'
import styles from './legal.module.css'

export type LegalSection = {
  heading: string
  body: ReactNode
}

// /terms, /privacy 공통 문서 레이아웃. 법률 문구 자체는 각 페이지가 데이터로 갖는다.
export function LegalDocument({
  title,
  meta,
  sections,
  backHref = '/mypage',
}: {
  title: string
  meta: string
  sections: LegalSection[]
  backHref?: string
}) {
  return (
    <SpecFrame backHref={backHref}>
      <div className={styles.doc}>
        {/* 문서 대표 헤딩(TC-BBL-008) — 화면 타이틀 없이 시작하는 시안 구조를 유지하기 위해
            시각적으로는 숨기고(title prop), 헤딩 계층(h1→h2 조문)만 노출한다. */}
        <h1 className='sr-only'>{title}</h1>
        <div className={styles.meta}>{meta}</div>
        {sections.map((section) => (
          <section className={styles.section} key={section.heading}>
            <h2 className={styles.h}>{section.heading}</h2>
            {section.body}
          </section>
        ))}
      </div>
    </SpecFrame>
  )
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <p className={styles.p}>{children}</p>
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ol className={styles.list}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  )
}
