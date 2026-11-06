import * as m from "motion/react-m"

/** A card that rises into place as it mounts, and lifts under the pointer. */
export default function Enter() {
  return (
    <m.div
      className="sample-card"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      Hello, Wardic
    </m.div>
  )
}
