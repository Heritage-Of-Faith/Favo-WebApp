// PIN login form — owner: Mine (task M1)
// PIN pad: numeric, 4–6 digits, masked dots, large keys (≥44×44px). Docs: docs/DESIGN.md

export type Props = {
  onSuccess: (staffId: string) => void;
};

// TODO (M1): implement PIN pad UI + call loginWithPin server action
export default function LoginForm(_props: Props) {
  return <div>LoginForm — task M1</div>;
}
