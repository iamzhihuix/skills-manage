import { Button as ButtonPrimitive } from "@base-ui/react/button"
import * as React from "react"
import { type VariantProps } from "class-variance-authority"

import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"

const Button = React.forwardRef<
  React.ElementRef<typeof ButtonPrimitive>,
  ButtonPrimitive.Props & VariantProps<typeof buttonVariants>
>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    ...props
  },
  ref
) {
  return (
    <ButtonPrimitive
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

export { Button }
