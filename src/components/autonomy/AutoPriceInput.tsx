import React, { useCallback, useContext } from 'react'
import styled, { ThemeContext } from 'styled-components'
import { Text } from '@pancakeswap/uikit'
import { AutoColumn } from '../Layout/Column'
import { AutoRow } from '../Layout/Row'
import NumericalInput from '../CurrencyInputPanel/NumericalInput'

const InputPanel = styled.div`
  display: flex;
  flex-flow: column nowrap;
  position: relative;
  border-radius: 1.25rem;
  background-color: ${({ theme }) => theme.colors.background};
  z-index: 1;
  width: 100%;
`

const ContainerRow = styled.div<{ error: boolean }>`
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 1.25rem;
  border: 1px solid ${({ error, theme }) => (error ? theme.colors.failure : theme.colors.contrast)};
  transition: border-color 300ms ${({ error }) => (error ? 'step-end' : 'step-start')},
    color 500ms ${({ error }) => (error ? 'step-end' : 'step-start')};
  background-color: ${({ theme }) => theme.colors.background};
`

const InputContainer = styled.div`
  flex: 1;
  padding: 1rem;
`

const StyledNumericalInput = styled(NumericalInput)<{ error?: boolean }>`
  font-size: 1.25rem;
  outline: none;
  border: none;
  flex: 1 1 auto;
  background-color: ${({ theme }) => theme.colors.background};
  transition: color 300ms ${({ error }) => (error ? 'step-end' : 'step-start')};
  color: ${({ error, theme }) => (error ? theme.colors.failure : theme.colors.text)};
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  width: 100%;
  ::placeholder {
    color: ${({ theme }) => theme.colors.textSubtle};
  }
  padding: 0px;
  -webkit-appearance: textfield;

  ::-webkit-search-decoration {
    -webkit-appearance: none;
  }

  ::-webkit-outer-spin-button,
  ::-webkit-inner-spin-button {
    -webkit-appearance: none;
  }

  ::placeholder {
    color: ${({ theme }) => theme.colors.textSubtle};
  }
`
const CurrentPriceTag = styled.span`
  border: 1px solid ${({ theme }) => theme.colors.primary};
  border-radius: 24px;
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  margin: 0 0.75rem;
  text-transform: uppercase;
  cursor: pointer;
`

export default function AutoPriceInput({
  id,
  value,
  currentPrice,
  onChange,
}: {
  id?: string
  value: string
  currentPrice?: string
  onChange: (value: string) => void
}) {
  const theme = useContext(ThemeContext)

  const error = false
  const disabled = currentPrice === undefined

  const handleInput = useCallback(
    (v) => {
      onChange(v)
    },
    [onChange],
  )

  return (
    <InputPanel id={id}>
      <ContainerRow error={error}>
        <InputContainer>
          <AutoColumn gap="md">
            <AutoRow>
              <Text color={theme.colors.text} fontWeight={500} fontSize="14px">
                Price
              </Text>
              <CurrentPriceTag onClick={() => !disabled && handleInput(currentPrice)}>Current</CurrentPriceTag>
            </AutoRow>
            <StyledNumericalInput
              className="price-input"
              placeholder="0.0"
              error={error}
              onUserInput={handleInput}
              value={value}
            />
          </AutoColumn>
        </InputContainer>
      </ContainerRow>
    </InputPanel>
  )
}
