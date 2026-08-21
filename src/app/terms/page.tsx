import type { ReactNode } from 'react'
import { LegalDocument, LegalList, LegalParagraph, type LegalSection } from '@/components/legal/legal-document'
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/terms'

function Em({ children }: { children: ReactNode }) {
  return <span style={{ color: '#0f1419', fontWeight: 600 }}>{children}</span>
}

const sections: LegalSection[] = [
  {
    heading: '제1조 (목적)',
    body: (
      <LegalParagraph>
        이 약관은 Jaroo(이하 “회사”)가 제공하는 AI 기반 국내 주식·ETF 포트폴리오 분석 서비스(이하 “서비스”)의 이용 조건과 절차,
        회사와 회원의 권리·의무 및 책임 사항을 규정하는 것을 목적으로 합니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제2조 (용어의 정의)',
    body: (
      <LegalList
        items={[
          '“서비스”: 회사가 모바일·웹 애플리케이션을 통해 제공하는 스크린샷 인식, 포트폴리오 관리, AI 분석(DeepScan), 시장 정보 제공 등 일체의 기능을 말합니다.',
          '"회원": 이 약관에 동의하고 회사가 정한 절차에 따라 회원가입하여 서비스를 이용하는 자를 말합니다.',
          '"게스트": 회원가입 없이 제한적으로 서비스를 둘러보는 자를 말합니다.',
          '"크레딧": 유료로 구매하여 AI 분석 등 유료 기능을 이용할 수 있는 수단을 말합니다.',
        ]}
      />
    ),
  },
  {
    heading: '제3조 (서비스의 성격과 한계)',
    body: (
      <>
        <LegalParagraph>
          <Em>서비스는 투자자문업·투자일임업 및 자본시장과 금융투자업에 관한 법률에 따른 투자자문·투자일임·투자매매 업무가 아닌, 데이터 기반 참고 정보 제공 서비스입니다.</Em>{' '}
          서비스가 제공하는 AI 분석 결과, 회복 전망, 전략 안내 등 일체의 내용(이하 “분석 결과”)은 특정 투자 판단의 근거로 활용될 수 있으나{' '}
          <Em>투자 권유, 매수·매도의 청약·권유, 수익 보장이 아니며</Em> 법률·회계·세무 자문이 아닙니다.
        </LegalParagraph>
        <LegalParagraph>
          분석 결과는 공개된 시장 데이터와 이용자가 제공한 정보를 알고리즘으로 산출한 것으로 그 정확성·완전성·적시성을 보장하지 않으며, 데이터 오류·지연이 있을 수 있습니다.{' '}
          <Em>모든 투자 판단과 그 결과에 대한 책임은 회원 본인에게 있습니다.</Em>
        </LegalParagraph>
      </>
    ),
  },
  {
    heading: '제4조 (이용계약의 성립과 동의)',
    body: (
      <LegalParagraph>
        이용계약은 회원이 서비스 가입 화면에서 만 14세 이상 여부를 확인하고, 이 약관 및 개인정보처리방침에 동의한 뒤 회원가입을 신청하고 회사가 이를 승낙함으로써 성립합니다.
        만 14세 미만 아동은 회원가입을 할 수 없습니다. 회원이 서비스를 이용하는 동안 이 약관의 내용을 계속 따라야 합니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제5조 (서비스 이용)',
    body: (
      <>
        <LegalParagraph>서비스는 회원과 게스트에게 제공되며, 게스트는 일부 기능만 이용할 수 있습니다.</LegalParagraph>
        <LegalParagraph>
          회사는 시스템 점검, 데이터 소스 장애, 법령 변경 등 운영상의 사유로 서비스의 전부 또는 일부를 중단하거나 변경할 수 있으며, 가능한 범위에서 사전에 안내합니다.
        </LegalParagraph>
        <LegalParagraph>
          회원은 다음 행위를 하여서는 안 됩니다. 이를 위반한 경우 회사는 서비스 이용을 제한하거나 회원자격을 상실시킬 수 있습니다.
        </LegalParagraph>
        <LegalList
          items={[
            '타인의 계정을 무단으로 사용하거나 계정을 양도·매매하는 행위',
            '회사가 제공하는 데이터·분석 결과를 무단으로 복제·재판매하는 행위',
            '자동화 수단(크롤러, 매크로 등)으로 서비스에 부하를 주거나 데이터를 대량 수집하는 행위',
            '법령·공서양속에 반하거나 다른 이용자·제3자의 권리를 침해하는 행위',
          ]}
        />
      </>
    ),
  },
  {
    heading: '제6조 (유료 서비스와 크레딧)',
    body: (
      <>
        <LegalParagraph>
          회사는 AI 분석 1회 등 소모성 기능을 이용할 수 있는 크레딧과, 정기 구독 상품(Jaroo Pro) 등 유료 서비스를 제공할 수 있습니다. 유료 서비스의 종류·가격·이용 조건은
          서비스 내 결제 화면에 표시된 내용에 따릅니다.
        </LegalParagraph>
        <LegalParagraph>
          <Em>구매한 크레딧은 소모성 재화로, 사용(소모)한 크레딧은 환불되지 않습니다.</Em> 결제 후 아직 사용하지 않은 크레딧은 관련 법령이 정하는 바에 따라 환불을 요청할 수
          있습니다.
        </LegalParagraph>
        <LegalParagraph>
          <Em>디지털 콘텐츠(분석 결과 등)는 그 이용이 개시된 이후에는 전자상거래 등에서의 소비자보호에 관한 법률 제17조 제2항 제5호에 따라 청약철회가 제한될 수 있습니다.</Em>{' '}
          결제 화면에 청약철회 제한 사실을 고지합니다.
        </LegalParagraph>
      </>
    ),
  },
  {
    heading: '제7조 (저작권 등 지식재산권)',
    body: (
      <LegalParagraph>
        회사가 작성한 분석 결과, 화면 디자인, 상표 등 서비스에 대한 지식재산권은 회사에 귀속됩니다. 회원은 서비스 내에서 제공되는 정보를 회사의 사전 동의 없이 영리 목적으로
        복제·전송·게시할 수 없습니다. 다만 회원이 자신의 투자 기록을 공유 목적으로 스크린샷 등으로 활용하는 것은 허용됩니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제8조 (회사의 면책)',
    body: (
      <>
        <LegalParagraph>
          회사는 천재지변, 전쟁, 데이터 소스 제공사의 장애 등 불가항력으로 인한 서비스 중단에 대해 책임을 지지 않습니다.
        </LegalParagraph>
        <LegalParagraph>
          <Em>
            회사는 분석 결과의 정확성·신뢰성을 보장하지 않으며, 회원이 분석 결과를 참고하여 행한 투자 판단으로 발생한 손해에 대해서는 책임을 지지 않습니다.
          </Em>
        </LegalParagraph>
        <LegalParagraph>회사는 회원이 게시하거나 제3자가 제공하는 정보의 정확성에 대해서는 책임을 지지 않습니다.</LegalParagraph>
      </>
    ),
  },
  {
    heading: '제9조 (회원 탈퇴와 자격 상실)',
    body: (
      <LegalParagraph>
        회원은 언제든지 서비스 내 “마이” 화면의 회원 탈퇴 기능을 통해 이용계약을 해지할 수 있습니다. 탈퇴 시 계정 정보, 포트폴리오, 분석 기록, 잔여 크레딧은 삭제되며
        복구할 수 없습니다. 다만 관련 법령에 따라 보존이 필요한 결제 기록 등은 해당 기간 동안 보관됩니다. 회사는 회원이 이 약관을 위반한 경우 사전 통지 후 회원자격을
        상실시킬 수 있습니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제10조 (약관의 변경)',
    body: (
      <LegalParagraph>
        회사는 관련 법령을 위배하지 않는 범위에서 이 약관을 변경할 수 있으며, 변경된 약관은 서비스 내 공지 후 시행됩니다. 회사가 “중대한 변경”을 하는 경우 최소 7일 전
        공지하며, 회원이 변경된 약관에 동의하지 않는 경우 탈퇴할 수 있습니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제11조 (문의 및 분쟁 해결)',
    body: (
      <LegalParagraph>
        서비스 이용에 관한 문의는 마이페이지 “문의하기” 또는 support@jaroo.kr 로 보내주세요. 회사와 회원 간 분쟁이 발생한 경우 상호 협의하여 해결하며, 협의가 이루어지지
        않는 경우 대한민국 법령을 준거법으로 하여 회사 소재지 관할 법원 또는 관련 법령이 정하는 기관의 결정에 따릅니다.
      </LegalParagraph>
    ),
  },
]

export const metadata = {
  title: '서비스 이용약관 | Jaroo',
}

export default function TermsPage() {
  return (
    <LegalDocument
      title='서비스 이용약관'
      meta={`시행일 ${TERMS_EFFECTIVE_DATE} · 버전 ${TERMS_VERSION}`}
      sections={sections}
    />
  )
}
