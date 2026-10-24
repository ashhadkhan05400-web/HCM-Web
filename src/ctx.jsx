import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from './firebase'

const C = createContext()
export const useApp = () => useContext(C)

export function AppProvider({ children }) {
  const [st, setSt] = useState({ loading: true })

  useEffect(() => {
    let unUser = () => {}
    const off = onAuthStateChanged(auth, async u => {
      unUser()
      try {
        const setup = !(await getDoc(doc(db, 'meta', 'init'))).exists()
        if (!u) {
          setSt({ loading: false, setup })
          return
        }
        unUser = onSnapshot(
          doc(db, 'users', u.uid),
          async us => {
            if (!us.exists()) {
              setSt({ loading: false, setup })
              return
            }
            try {
              const [s, e] = await Promise.all([
                getDoc(doc(db, 'settings', 'company')),
                getDoc(doc(db, 'employees', u.uid)),
              ])
              setSt({
                loading: false,
                setup,
                user: { uid: u.uid, ...us.data() },
                settings: s.data() || null,
                emp: e.exists() ? { id: e.id, ...e.data() } : null,
              })
            } catch (err) {
              console.error('ctx load error', err)
              setSt({ loading: false, setup, user: { uid: u.uid, ...us.data() }, settings: null, emp: null })
            }
          },
          err => {
            console.error('user snapshot', err)
            setSt({ loading: false, setup })
          }
        )
      } catch (err) {
        console.error('auth state', err)
        setSt({ loading: false, setup: true })
      }
    })
    return () => {
      off()
      unUser()
    }
  }, [])

  return <C.Provider value={st}>{children}</C.Provider>
}