import { createFileRoute, Outlet, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/vessels')({
  component: VesselsLayout,
})

function VesselsLayout() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vessels</h1>
        <div className="space-x-2 text-sm">
          <Link to="/vessels/search" className="underline">
            Search
          </Link>
        </div>
      </div>
      <Outlet />
    </div>
  )
}
