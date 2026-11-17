export function SkipLink({
  href = '#main',
  children = 'Перейти до основного вмісту',
}: {
  href?: string
  children?: string
}) {
  return (
    <a
      href={href}
      data-skip-link
      className="bg-accent text-on-accent rounded-md px-4 py-2 text-body font-medium shadow-md absolute left-2 top-2 z-50 -translate-y-20 focus:translate-y-0 transition-transform duration-150"
    >
      {children}
    </a>
  )
}
